"use client";

import { useEffect, useState } from "react";

/** Below this, the page's answer and the fresh one are the same spot. */
const MOVED_SEC = 5;

/**
 * The resume point as of now, not as of whenever the page was rendered (see
 * /api/resume-point). Starts as the page's value so playback never waits on
 * this; if the fresh answer has moved, the player seeks to it.
 */
export function useFreshResume(query: string | null, fromPage: number): number {
  const [seconds, setSeconds] = useState(fromPage);
  useEffect(() => {
    if (!query) return;
    let live = true;
    fetch(`/api/resume-point?${query}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { seconds?: number | null } | null) => {
        if (!live || typeof d?.seconds !== "number") return;
        const fresh = d.seconds;
        setSeconds((current) => (Math.abs(fresh - current) > MOVED_SEC ? fresh : current));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [query]);
  return seconds;
}
