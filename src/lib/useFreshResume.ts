"use client";

import { useEffect, useState, type RefObject } from "react";

/** Below this, two positions are the same spot. */
const MOVED_SEC = 5;

async function fetchResumePoint(query: string): Promise<number | null> {
  try {
    const r = await fetch(`/api/resume-point?${query}`, { cache: "no-store" });
    if (!r.ok) return null;
    const d = (await r.json()) as { seconds?: number | null };
    return typeof d.seconds === "number" ? d.seconds : null;
  } catch {
    return null;
  }
}

/**
 * The resume point as of now, not as of whenever the page was rendered (see
 * /api/resume-point). Starts as the page's value so playback never waits on
 * this; if the fresh answer has moved, the player seeks to it.
 *
 * useResumeRecheck re-checks whenever the viewer comes back to a paused
 * player (tab or window regains focus): a Streamy player left open while something was
 * watched on the Roku or in Jellyfin would otherwise carry on from its own,
 * now stale, spot -- reported 2026-09-30 as "Jellyfin follows Streamy but not
 * the other way round". A playing video is never moved.
 */
export function useFreshResume(query: string | null, fromPage: number): number {
  const [seconds, setSeconds] = useState(fromPage);

  useEffect(() => {
    if (!query) return;
    let live = true;
    void fetchResumePoint(query).then((fresh) => {
      if (!live || fresh == null) return;
      setSeconds((current) => (Math.abs(fresh - current) > MOVED_SEC ? fresh : current));
    });
    return () => {
      live = false;
    };
  }, [query]);

  return seconds;
}

/** The return-to-a-paused-player half of useFreshResume; needs the player's element. */
export function useResumeRecheck(query: string | null, videoRef: RefObject<HTMLVideoElement | null>): void {
  useEffect(() => {
    if (!query) return;
    let checking = false;
    const recheck = async () => {
      const v = videoRef.current;
      if (document.visibilityState !== "visible" || !v || !v.paused || checking) return;
      checking = true;
      const fresh = await fetchResumePoint(query);
      checking = false;
      const now = videoRef.current;
      // Still paused and still the same element: only then is moving it safe.
      if (fresh == null || !now || now !== v || !now.paused) return;
      if (Math.abs(fresh - now.currentTime) > MOVED_SEC) {
        try {
          now.currentTime = fresh;
        } catch {
          // Not seekable yet; the next return will try again.
        }
      }
    };
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("focus", recheck);
    return () => {
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("focus", recheck);
    };
  }, [query, videoRef]);
}
