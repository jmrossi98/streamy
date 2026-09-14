"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applySave,
  diffStorage,
  hasChanges,
  mergeSave,
  snapshotStorage,
  type SaveBlob,
} from "@/lib/flashSaves";

type Props = {
  src: string;
  title: string;
  /** Game identity, for the save row. Omit to play without saving. */
  slug?: string;
  /** Stage size from the SWF header, so the frame is right before it loads. */
  width: number;
  height: number;
};

type RufflePlayerElement = HTMLElement & {
  load: (options: { url: string }) => Promise<void>;
  remove: () => void;
};
type RuffleApi = { newest: () => { createPlayer: () => RufflePlayerElement } | null };

declare global {
  interface Window {
    RufflePlayer?: RuffleApi;
  }
}

/** Loaded once per page, not per player -- a second <script> re-runs the polyfill. */
let ruffleScript: Promise<void> | null = null;

function loadRuffle(): Promise<void> {
  if (ruffleScript) return ruffleScript;
  ruffleScript = new Promise((resolve, reject) => {
    if (window.RufflePlayer) return resolve();
    const el = document.createElement("script");
    // Served from public/, copied there by scripts/copy-ruffle.mjs -- the
    // selfhosted package expects to be plain static files, not bundled.
    el.src = "/ruffle/ruffle.js";
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("Couldn’t load the Flash player."));
    document.head.appendChild(el);
  });
  return ruffleScript;
}

/**
 * Plays a SWF through Ruffle.
 *
 * No browser has had a Flash runtime for years, so this is a WASM
 * reimplementation rather than a plugin. It is genuinely good at ActionScript
 * 1 and 2 and still incomplete at 3, which is why the catalogue records
 * isActionScript3 at import and the page warns before you get here.
 *
 * Sized from the SWF's own header rather than left to fill the container: a
 * Flash movie has a fixed stage, and stretching it to an arbitrary box is how
 * you get a game whose buttons are in the wrong place.
 */
export function FlashPlayer({ src, title, slug, width, height }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  /** localStorage as it looked before this game ran -- the diff baseline. */
  const baselineRef = useRef<SaveBlob>({});

  /**
   * Pushes whatever the game wrote back to the server.
   *
   * Diffed against the baseline rather than sending all of localStorage: this
   * origin holds other things, and a game's save should not carry them.
   */
  const persist = useCallback(async () => {
    if (!slug) return;
    let changed: SaveBlob;
    try {
      changed = diffStorage(baselineRef.current, snapshotStorage(window.localStorage));
    } catch {
      // Storage can throw outright in a private window or with site data
      // blocked. Nothing to save, and nothing worth reporting.
      return;
    }
    if (!hasChanges(changed)) return;

    setSaveState("saving");
    try {
      const res = await fetch(`/api/flash/save/${encodeURIComponent(slug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: changed }),
        // The unmount path fires during navigation, where a normal fetch is
        // routinely cancelled. keepalive is what lets it outlive the page.
        keepalive: true,
      });
      setSaveState(res.ok ? "saved" : "failed");
    } catch {
      setSaveState("failed");
    }
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    let player: RufflePlayerElement | null = null;

    // Hydrate before Ruffle starts: it reads SharedObjects out of localStorage
    // as the movie loads, so a save arriving afterwards is a save the game
    // never sees.
    const hydrate = async () => {
      try {
        baselineRef.current = snapshotStorage(window.localStorage);
      } catch {
        baselineRef.current = {};
      }
      if (!slug) return;
      try {
        const res = await fetch(`/api/flash/save/${encodeURIComponent(slug)}`);
        if (!res.ok) return;
        const { data } = (await res.json()) as { data: SaveBlob | null };
        if (!data || cancelled) return;
        applySave(window.localStorage, mergeSave({}, data));
        // Re-baselined after hydrating, or the restored save would itself look
        // like a change and be written straight back on every visit.
        baselineRef.current = snapshotStorage(window.localStorage);
      } catch {
        // An unreachable server means playing with whatever this device has --
        // degraded, not broken.
      }
    };

    hydrate()
      .then(loadRuffle)
      .then(() => {
        if (cancelled) return;
        const api = window.RufflePlayer?.newest();
        const host = hostRef.current;
        if (!api || !host) throw new Error("The Flash player didn’t start.");

        player = api.createPlayer();
        player.style.width = "100%";
        player.style.height = "100%";
        host.appendChild(player);
        return player.load({ url: src });
      })
      .then(() => {
        if (!cancelled) setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "This game couldn’t be loaded.");
        setLoading(false);
      });

    // Periodic, not only on exit. A tab closed with the X never runs an
    // unmount, and losing an hour of progress to that is exactly the failure
    // this feature exists to prevent.
    const timer = window.setInterval(() => void persist(), 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      void persist();
      // Ruffle keeps a WASM instance and an audio context alive per player;
      // leaving one behind on navigation means the previous game is still
      // running, and audible.
      player?.remove();
    };
  }, [src, slug, persist]);

  return (
    <div className="w-full">
      <div
        ref={hostRef}
        // The stage's own aspect ratio, so the frame is correct before the
        // movie loads and doesn't jump when it does.
        style={{ aspectRatio: width > 0 && height > 0 ? `${width} / ${height}` : "4 / 3" }}
        className="relative w-full overflow-hidden rounded-lg bg-black"
        aria-label={title}
      >
        {saveState !== "idle" && !error && (
          <p className="pointer-events-none absolute right-2 top-2 rounded bg-black/70 px-2 py-1 text-[11px] text-white/70">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Progress saved" : "Save failed"}
          </p>
        )}
        {(loading || error) && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            {error ? (
              <p className="text-sm text-red-400">{error}</p>
            ) : (
              <p className="text-sm text-white/50">Loading…</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
