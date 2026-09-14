"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  src: string;
  title: string;
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
export function FlashPlayer({ src, title, width, height }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let player: RufflePlayerElement | null = null;

    loadRuffle()
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

    return () => {
      cancelled = true;
      // Ruffle keeps a WASM instance and an audio context alive per player;
      // leaving one behind on navigation means the previous game is still
      // running, and audible.
      player?.remove();
    };
  }, [src]);

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
