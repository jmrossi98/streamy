"use client";

import { useEffect, useState, type RefObject } from "react";
import { pickResumeSeconds, RESUME_ANSWER_WAIT_MS, RESUME_MOVED_SEC } from "./resumeStartRules";

/**
 * Null only when the question could not be asked. "Nothing saved" is an
 * answer, and it is 0: read as null it left the page's own value standing,
 * and a page rendered for somebody else -- another account in the same
 * browser, or a copy the browser kept -- then started this viewer at that
 * person's position and saved it as theirs.
 */
async function fetchResumePoint(query: string): Promise<number | null> {
  try {
    const r = await fetch(`/api/resume-point?${query}`, { cache: "no-store" });
    if (!r.ok) return null;
    const d = (await r.json()) as { seconds?: number | null; signedIn?: boolean };
    if (typeof d.seconds === "number") return d.seconds;
    return d.signedIn ? 0 : null;
  } catch {
    return null;
  }
}

/**
 * The resume point as of now, not as of whenever the page was rendered (see
 * /api/resume-point). Starts as the page's value; `settled` turns true once
 * the fresh answer is in, could not be had, or took longer than
 * RESUME_ANSWER_WAIT_MS. Direct play starts straight away and moves if the
 * answer moved; a transcode waits for `settled` (see resumeStartRules.ts for
 * why starting one at the wrong spot is what made Resume fail first time).
 *
 * useResumeRecheck re-checks whenever the viewer comes back to a paused
 * player (tab or window regains focus): a Streamy player left open while something was
 * watched on the Roku or in Jellyfin would otherwise carry on from its own,
 * now stale, spot -- reported 2026-09-30 as "Jellyfin follows Streamy but not
 * the other way round". A playing video is never moved.
 */
export function useFreshResume(query: string | null, fromPage: number): { seconds: number; settled: boolean } {
  // Keyed by the question, so a player that moves to another episode without
  // remounting starts from that episode's page value and waits again, rather
  // than comparing against (and keeping) the previous episode's answer.
  const [state, setState] = useState({ query, seconds: fromPage, settled: !query });
  const current = state.query === query ? state : { query, seconds: fromPage, settled: !query };

  useEffect(() => {
    if (!query) return;
    let live = true;
    const settle = (fresh: number | null) => {
      if (!live) return;
      setState((s) => ({
        query,
        seconds: pickResumeSeconds(s.query === query ? s.seconds : fromPage, fresh),
        settled: true,
      }));
    };
    // Too slow to wait for: let a transcode start from the page's value. The
    // answer still counts when it comes; the player moves to it if the viewer
    // has not moved off the start (see shouldMoveStartedPlayback).
    const timer = setTimeout(() => settle(null), RESUME_ANSWER_WAIT_MS);
    void fetchResumePoint(query).then((fresh) => {
      clearTimeout(timer);
      settle(fresh);
    });
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // fromPage deliberately not a dependency: a re-render with a different
    // page value for the same title must not throw away a fresh answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return { seconds: current.seconds, settled: current.settled };
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
      if (Math.abs(fresh - now.currentTime) > RESUME_MOVED_SEC) {
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
