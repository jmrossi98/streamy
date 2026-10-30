"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui";
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
  /**
   * The address the game should believe it is running at. For sitelocked
   * games: they check their own URL and refuse to run anywhere but the site
   * that licensed them -- "Game Game" only plays on andkon.com. Ruffle has no
   * spoof option on the web, but loading the bytes with a swfFileName makes
   * that name the movie's URL (resolved against the page, so an absolute URL
   * stands as-is), which is what the lock reads.
   */
  spoofUrl?: string | null;
};

/**
 * Where the Full screen button goes when the page offers a spot for it (the
 * title row), so it doesn't sit below the fold under a screen-tall stage.
 */
export const FLASH_ACTIONS_SLOT_ID = "flash-player-actions";

type RufflePlayerElement = HTMLElement & {
  load: (options: { url: string } | { data: ArrayBuffer; swfFileName?: string }) => Promise<void>;
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
 *
 * Within that, it is as big as the window allows: as wide as the column, but
 * never taller than the screen below the page header, so the whole stage is
 * visible without scrolling. A Full screen button goes further. Where the
 * browser can't make an element fullscreen (iPhone Safari), it fills the
 * window instead. Either way Ruffle letterboxes the stage, so it keeps its
 * shape.
 */
export function FlashPlayer({ src, title, slug, width, height, spoofUrl = null }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<RufflePlayerElement | null>(null);
  /** Fullscreen via the Fullscreen API, or the fill-the-window fallback. */
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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

    try {
      const res = await fetch(`/api/flash/save/${encodeURIComponent(slug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: changed }),
        // The unmount path fires during navigation, where a normal fetch is
        // routinely cancelled. keepalive is what lets it outlive the page.
        keepalive: true,
      });
      if (!res.ok) console.warn(`flash save for ${slug} failed: ${res.status}`);
    } catch {
      // Navigation can cancel the request; the next session re-saves anyway.
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

    // hydrate() and loadRuffle() have nothing to do with each other -- the
    // save-data fetch and the Ruffle runtime download are two independent
    // round trips that were needlessly chained, stacking their latency
    // instead of overlapping it. The only real ordering constraint, per the
    // comment above hydrate(), is that localStorage must be restored before
    // player.load() actually starts the movie -- not before Ruffle's script
    // even begins downloading. Promise.all keeps that constraint and removes
    // the artificial one.
    Promise.all([hydrate(), loadRuffle()])
      .then(() => {
        if (cancelled) return;
        const api = window.RufflePlayer?.newest();
        const host = hostRef.current;
        if (!api || !host) throw new Error("The Flash player didn’t start.");

        player = api.createPlayer();
        playerRef.current = player;
        player.style.width = "100%";
        player.style.height = "100%";
        host.appendChild(player);
        if (!spoofUrl) return player.load({ url: src });
        // Same file, fetched here so it can be handed over as bytes under
        // the original site's address -- see spoofUrl.
        return fetch(src)
          .then((res) => {
            if (!res.ok) throw new Error("This game couldn’t be loaded.");
            return res.arrayBuffer();
          })
          .then((data) => {
            if (cancelled || !player) return;
            return player.load({ data, swfFileName: spoofUrl });
          });
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
      playerRef.current = null;
    };
  }, [src, slug, persist]);

  // Leaving real fullscreen with Esc or the browser's own control ends it here too.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setExpanded(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Esc closes the fill-the-window fallback, which the browser doesn't manage.
  useEffect(() => {
    if (!expanded || document.fullscreenElement) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const toggleExpanded = useCallback(async () => {
    const frame = frameRef.current;
    if (!frame) return;
    if (expanded) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (frame.requestFullscreen) {
      // A refusal (no user gesture, iframe policy) leaves the window fallback.
      await frame.requestFullscreen().catch(() => {});
    }
    // Clicking the button took keyboard focus; games read the keyboard.
    playerRef.current?.focus();
  }, [expanded]);

  // The page's title-row slot, found after mount (portals need a real node).
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setActionsSlot(document.getElementById(FLASH_ACTIONS_SLOT_ID));
  }, []);

  const ratio = width > 0 && height > 0 ? width / height : 4 / 3;

  const toggleButton = (
    <Button variant="secondary" size="sm" onClick={() => void toggleExpanded()}>
      {expanded ? "Exit full screen" : "Full screen"}
    </Button>
  );

  return (
    <div className="w-full">
      {actionsSlot && !expanded && createPortal(toggleButton, actionsSlot)}
      <div
        ref={frameRef}
        className={
          expanded
            ? "fixed inset-0 z-[100] flex flex-col bg-black"
            : "mx-auto"
        }
        // Not taller than the screen below the header and title row (~14rem);
        // the width that height allows, capped at the column.
        style={expanded ? undefined : { width: `min(100%, calc((100dvh - 14rem) * ${ratio}))`, minWidth: "min(100%, 320px)" }}
      >
        <div
          ref={hostRef}
          // The stage's own aspect ratio, so the frame is correct before the
          // movie loads and doesn't jump when it does. Expanded, it fills the
          // screen and Ruffle letterboxes the stage inside it.
          style={expanded ? undefined : { aspectRatio: `${ratio}` }}
          className={
            expanded
              ? "relative min-h-0 w-full flex-1 overflow-hidden bg-black"
              : "relative w-full overflow-hidden rounded-lg bg-black"
          }
          aria-label={title}
        >
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
        {(expanded || !actionsSlot) && (
          <div className={expanded ? "flex justify-end p-2" : "mt-2 flex justify-end"}>{toggleButton}</div>
        )}
      </div>
    </div>
  );
}
