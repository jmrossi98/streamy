import { cached } from "./ttlCache";
import { getTodaysFixtures, type Fixture } from "./sportsSchedule";
import { getMappedChannelPrograms } from "./dispatcharr";
import { matchFixturesToEpgProgrammes } from "./liveTimeline";

export type ScheduleFixture = Fixture & {
  /** Channel names Dispatcharr's real EPG confirms are airing this fixture right now. */
  epgConfirmedChannelNames: string[];
};

/**
 * How long a built schedule is served as-is. Short enough that a score clock
 * or a game going final is at most this late; long enough that a page load
 * never waits on ESPN plus a ~10k-row EPG match (median 1.4s, p90 4.3s
 * measured 2026-10-23), which is what made "Live now" pop in after the page.
 */
const SCHEDULE_TTL_MS = 30_000;

async function build(): Promise<ScheduleFixture[]> {
  const fixtures = await getTodaysFixtures();
  // Best effort: EPG confirmation only ever adds a channel name; ESPN alone
  // already answers the schedule.
  let epgConfirmedByFixtureId = new Map<string, string[]>();
  try {
    const programs = await getMappedChannelPrograms();
    if (programs) epgConfirmedByFixtureId = matchFixturesToEpgProgrammes(fixtures, programs);
  } catch (err) {
    console.error("[live/schedule] EPG match failed:", err);
  }
  return fixtures.map((f) => ({ ...f, epgConfirmedChannelNames: epgConfirmedByFixtureId.get(f.id) ?? [] }));
}

/**
 * Today's fixtures with their EPG-confirmed channels. Stale-while-revalidate:
 * after the first build, callers get the last answer at once and the refresh
 * happens behind them. An empty list (ESPN unreachable) is not cached.
 */
export function getLiveSchedule(): Promise<ScheduleFixture[]> {
  return cached("live-schedule", SCHEDULE_TTL_MS, build, {
    staleWhileRevalidate: true,
    skipCacheIf: (v) => v.length === 0,
  });
}

/**
 * The schedule for a page render, or null if it isn't ready within `deadlineMs`.
 * Null hands the job to the browser (LiveNowGames fetches it itself), so a
 * cold cache costs the games row a moment, never the whole page.
 */
export async function getLiveScheduleForRender(deadlineMs = 1_500): Promise<ScheduleFixture[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), deadlineMs);
  });
  try {
    return await Promise.race([getLiveSchedule().catch(() => null), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
