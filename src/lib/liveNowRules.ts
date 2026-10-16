/**
 * Which games the Live TV "Now" tab leads with.
 *
 * The tab opens on what can be watched this minute, which for sports means
 * games in progress -- not the whole slate, which is the Sports tab's job.
 * When nothing is on, an empty "Live now" heading is worse than useless, so
 * the section turns into "Up next" and names the next few kickoffs instead.
 *
 * Pure: takes the fixtures as /api/live/schedule returns them and answers
 * with a list, so the choice is testable without ESPN.
 */

import type { FixtureState } from "./sportsSchedule";

export type NowFixture = {
  id: string;
  league: string;
  startUtc: string | null;
  detail: string;
  state: FixtureState;
  name: string;
};

export type LiveNowPick<F extends NowFixture> =
  | { kind: "live"; fixtures: F[] }
  | { kind: "upnext"; fixtures: F[] };

/** How many upcoming games "Up next" shows. Three is a glance, not a schedule. */
export const UP_NEXT_COUNT = 3;

function startMs(f: NowFixture): number {
  if (!f.startUtc) return Number.POSITIVE_INFINITY;
  const ms = new Date(f.startUtc).getTime();
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/**
 * In-progress games first; failing that, the next few to start.
 *
 * `watchableIds` are the fixtures the lineup already has a channel for. They
 * sort to the front within each group rather than filtering the rest out:
 * since the game page grew a stream finder, a game with no channel in the
 * lineup is one search away from watchable, not a dead end -- but the ones a
 * click will play should still come first.
 *
 * Upcoming games are the ones that have not started and have a start time;
 * a fixture ESPN gives no kickoff for (common for motorsport) cannot be
 * "next", so it is left to the Sports tab.
 */
export function pickLiveNow<F extends NowFixture>(
  fixtures: F[],
  opts: { nowMs?: number; watchableIds?: ReadonlySet<string> } = {}
): LiveNowPick<F> {
  const nowMs = opts.nowMs ?? Date.now();
  const watchable = opts.watchableIds ?? new Set<string>();
  const byWatchable = (a: F, b: F) => Number(watchable.has(b.id)) - Number(watchable.has(a.id));

  const live = fixtures.filter((f) => f.state === "in");
  if (live.length > 0) {
    // Stable sort: ESPN's league order is kept within each group.
    return { kind: "live", fixtures: [...live].sort(byWatchable) };
  }

  const upcoming = fixtures
    .filter((f) => f.state === "pre" && Number.isFinite(startMs(f)) && startMs(f) >= nowMs)
    .sort((a, b) => byWatchable(a, b) || startMs(a) - startMs(b))
    .slice(0, UP_NEXT_COUNT);
  return { kind: "upnext", fixtures: upcoming };
}
