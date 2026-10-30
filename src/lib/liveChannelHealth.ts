/**
 * What each live channel is currently good for.
 *
 * Two inputs, deliberately separate:
 *
 *   - live-channels.json, published by mediabox's live-channel-check.py,
 *     which samples each stream with ffmpeg. It says whether the picture is
 *     playing, frozen or silent. It runs there because the streams are there
 *     and pulling twenty-five video samples across the tailnet to answer
 *     "is this alive" would move real bandwidth for a local question.
 *   - the sports schedule, which says whether the event a team channel
 *     advertises is actually happening.
 *
 * Neither alone is enough. A channel named for a team streams h264 with
 * audio whether or not the team is playing -- measured 2026-09-26, with no
 * NFL, NBA or NHL game in progress anywhere -- so the picture cannot tell you
 * it is filler. And the schedule cannot tell you a channel is dead.
 */
import {
  channelVerdict,
  hiddenForViewers,
  KEEPING_UP_SPEED,
  liveAliases,
  streamQualityRank,
  type ChannelVerdict,
  type StreamHealth,
} from "./liveChannelRules";
import { getTodaysFixtures } from "./sportsSchedule";
import { namesBothTeams } from "./liveTimeline";
import { eventSlotLabel, eventSlotState } from "./eventSlotRules";
import { channelKey, withWorkingState } from "./liveChannelStateRules";
import { channelWorkingMap, viewerSlowMap } from "./liveChannelState";
import { rankWithViewers, type ViewerSlow } from "./viewerSlowRules";

const PROBE_TIMEOUT_MS = 8_000;

type PublishedChannel = {
  number?: string;
  name?: string;
  playable?: boolean;
  frozen?: boolean | null;
  silent?: boolean | null;
  detail?: string;
  speed?: number | null;
  speedAt?: string | null;
  failures?: number | null;
  downSince?: string | null;
  checkedAt?: string | null;
};

type Published = { generatedAt?: string; channels?: PublishedChannel[] };

/**
 * Keyed by name rather than number: the tuner renumbers its channels on every
 * playlist refresh, which is the same reason gameChannelChoice stores a name
 * alongside its id.
 */
export type ChannelHealthMap = Map<string, StreamHealth>;

export async function fetchPublishedChannelHealth(): Promise<{
  generatedAt: string | null;
  health: ChannelHealthMap;
} | null> {
  const base = process.env.FLASH_LIBRARY_URL?.replace(/\/$/, "");
  if (!base) return null;
  try {
    const res = await fetch(`${base}/status/live-channels.json`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Published;
    const health: ChannelHealthMap = new Map();
    for (const c of body.channels ?? []) {
      if (!c.name) continue;
      health.set(normaliseName(c.name), {
        playable: c.playable === true,
        frozen: c.frozen ?? undefined,
        silent: c.silent ?? undefined,
        detail: c.detail,
        speed: typeof c.speed === "number" ? c.speed : undefined,
        speedAt: c.speedAt ?? undefined,
        failures: typeof c.failures === "number" ? c.failures : undefined,
        downSince: c.downSince ?? undefined,
        checkedAt: c.checkedAt ?? undefined,
      });
    }
    return { generatedAt: body.generatedAt ?? null, health };
  } catch {
    return null;
  }
}

/** How old the checker's results may be and still be acted on (it runs half-hourly). */
const HEALTH_TRUST_MS = 90 * 60_000;

/**
 * Normalised names of channels that would not open at the checker's last scan
 * -- empty when there is no recent scan, so an old "down" can never bury a
 * channel that has since come back. Never throws.
 */
export async function channelHealthForRanking(now: number = Date.now()): Promise<{
  notResponding: Set<string>;
  /** Normalised name -> streamQualityRank. A channel not in it is unknown (1). */
  quality: Map<string, number>;
  /** Normalised name -> measured speed, for the ones measured recently. */
  speeds: Map<string, number>;
  /**
   * Normalised names of channels people could not get a picture from
   * (liveChannelStateRules.ts): left out of game picking entirely. A channel
   * offered again after its cool-off ("retrying") is in notResponding
   * instead, so it can still be picked but never as the default.
   */
  notWorking: Set<string>;
  /** Channels viewers have been stalling on (viewerSlowRules.ts), already folded into `quality`. */
  viewerSlow: Map<string, ViewerSlow>;
}> {
  const empty = {
    notResponding: new Set<string>(),
    quality: new Map<string, number>(),
    speeds: new Map<string, number>(),
    notWorking: new Set<string>(),
    viewerSlow: new Map<string, ViewerSlow>(),
  };
  try {
    const published = await fetchPublishedChannelHealth();
    const [working, viewerSlow] = await Promise.all([
      channelWorkingMap(published?.health),
      viewerSlowMap(published?.health, now),
    ]);
    for (const [key, w] of working) {
      if (w.state === "not-working") empty.notWorking.add(key);
      else if (w.state === "retrying") empty.notResponding.add(key);
    }
    // Viewers stalling on a channel ranks it as slow (viewerSlowRules.ts),
    // whether or not the checker's snapshot is fresh enough to use.
    const withViewers = (quality: Map<string, number>, speeds: Map<string, number>) => {
      for (const [key, slow] of viewerSlow) {
        quality.set(key, rankWithViewers(quality.get(key), slow)!);
        // A checker speed that reads "keeping up" would badge it Smooth.
        if ((speeds.get(key) ?? 0) >= KEEPING_UP_SPEED) speeds.delete(key);
      }
      return { quality, speeds };
    };
    const at = published?.generatedAt ? Date.parse(published.generatedAt) : NaN;
    if (!published || !Number.isFinite(at) || now - at > HEALTH_TRUST_MS) {
      return { ...empty, ...withViewers(empty.quality, empty.speeds), viewerSlow };
    }
    const quality = new Map<string, number>();
    const speeds = new Map<string, number>();
    for (const [name, h] of published.health) {
      const rank = streamQualityRank(h, now);
      quality.set(name, rank);
      // Only a reading that counted towards the rank is worth showing.
      if (h.speed != null && rank !== 1 && !(h.playable && h.frozen)) speeds.set(name, h.speed);
    }
    return {
      notResponding: new Set([
        ...empty.notResponding,
        ...[...published.health].filter(([, h]) => !h.playable).map(([name]) => name),
      ]),
      ...withViewers(quality, speeds),
      notWorking: empty.notWorking,
      viewerSlow,
    };
  } catch {
    return empty;
  }
}

export async function notRespondingChannels(now: number = Date.now()): Promise<Set<string>> {
  try {
    const published = await fetchPublishedChannelHealth();
    const at = published?.generatedAt ? Date.parse(published.generatedAt) : NaN;
    if (!published || !Number.isFinite(at) || now - at > HEALTH_TRUST_MS) return new Set();
    return new Set([...published.health].filter(([, h]) => !h.playable).map(([name]) => name));
  } catch {
    return new Set();
  }
}

/**
 * Channel names arrive with provider decoration -- superscript HD marks,
 * punctuation, doubled spaces -- and the same channel is not always spelled
 * identically between the lineup and the tuner. Lowercasing and stripping
 * anything that is not a letter or digit is enough to match them without
 * pretending to understand the naming.
 */
export function normaliseName(name: string): string {
  return channelKey(name);
}

export type ChannelStatus = ChannelVerdict & { checkedAt: string | null };

/**
 * A verdict per channel name, for however many channels are asked about.
 *
 * Resolves the schedule once for the whole set rather than per channel: the
 * live page renders every tile at once, and three leagues per tile would be a
 * burst of identical requests to someone else's API.
 */
export async function channelStatuses(
  channelNames: string[]
): Promise<Map<string, ChannelStatus>> {
  // getTodaysFixtures already powers the fixtures page and covers eleven
  // leagues; deriving live teams from it beats a second, narrower scoreboard
  // client that would drift out of step with the page people actually read.
  //
  // An empty list is not the same as a failed lookup, and both arrive here as
  // []. Treating a network blip as "nothing is on" would mark every working
  // team channel as filler, so a throw is caught into null instead.
  const [published, fixtures] = await Promise.all([
    fetchPublishedChannelHealth(),
    getTodaysFixtures().catch(() => null),
  ]);
  // Whether people can actually get a picture, from their own tunes.
  const working = await channelWorkingMap(published?.health);
  const live = fixtures ? liveAliases(fixtures) : null;
  const inProgress = (fixtures ?? []).filter((f) => f.state === "in");

  const out = new Map<string, ChannelStatus>();
  const now = Date.now();
  for (const name of channelNames) {
    const health = published?.health.get(normaliseName(name)) ?? null;
    out.set(name, {
      // The event slot's clock goes last: a game that is over hides its slot
      // everywhere, working or not.
      ...eventSlotVerdict(
        name,
        now,
        inProgress,
        withWorkingState(channelVerdict(name, health, live, now), working.get(normaliseName(name)))
      ),
      checkedAt: published?.generatedAt ?? null,
    });
  }
  return out;
}

/**
 * A per-game event slot is judged by the clock before the probe -- see
 * eventSlotRules.ts. Before its game it is a slate however healthy the
 * stream looks; after it, nothing worth listing until tomorrow.
 */
function eventSlotVerdict(
  name: string,
  now: number,
  inProgress: { awayTeam: string | null; homeTeam: string | null }[],
  verdict: ChannelVerdict
): ChannelVerdict {
  const state = eventSlotState(name, now);
  // The slot's clock is a guess at when its game ends (SLOT_LASTS_MS). While
  // ESPN still has the game named in it in progress -- overtime, a rain
  // delay, extra innings -- it is not over, whatever the clock says.
  if (state === "over" && inProgress.some((f) => namesBothTeams(name, f))) return verdict;
  if (state === "upcoming") return { state: "no-event", detail: eventSlotLabel(name, now) ?? "Not started yet" };
  if (state === "over") return { state: "filler", detail: eventSlotLabel(name, now) ?? "Game over", hidden: true };
  return verdict;
}

/** One row of the admin "Not working" list. */
export type NotWorkingRow = {
  name: string;
  /** "slow": still offered, but ranked below smooth channels because viewers kept stalling on it. */
  state: "not-working" | "retrying" | "slow";
  /**
   * "tunes": people could not get a picture. "checker": mediabox's scans found
   * it dead. "viewers": people's players kept stalling on it.
   */
  source: "tunes" | "checker" | "viewers";
  failedTunes: number;
  people: string[];
  lastFailureAt: number | null;
  lastError: string | null;
  /** When a hidden channel is offered again on its own, for "tunes"; when a slow one stops counting, for "viewers". */
  retryAt: number | null;
  /** For "viewers": two or more people, or a viewer whose other channels played fine meanwhile. */
  corroborated?: boolean;
};

/**
 * Lineup channels hidden for not working, back on trial, or ranked down for
 * viewers stalling on them, for the admin list. Never throws.
 */
export async function notWorkingReport(
  channelNames: string[],
  now: number = Date.now()
): Promise<{ rows: NotWorkingRow[]; generatedAt: number }> {
  try {
    const published = await fetchPublishedChannelHealth();
    const [working, viewerSlow] = await Promise.all([
      channelWorkingMap(published?.health, now),
      viewerSlowMap(published?.health, now),
    ]);
    const rows: NotWorkingRow[] = [];
    for (const name of channelNames) {
      const key = normaliseName(name);
      const w = working.get(key);
      const health = published?.health.get(key);
      if (health && hiddenForViewers(health)) {
        // The checker's verdict wins here as it does on /live (withWorkingState).
        const down = health.downSince ? Date.parse(health.downSince) : NaN;
        rows.push({
          name,
          state: "not-working",
          source: "checker",
          failedTunes: w?.failedTunes ?? 0,
          people: w?.people ?? [],
          lastFailureAt: Number.isFinite(down) ? down : null,
          lastError: health.detail ?? null,
          retryAt: null,
        });
      } else if (w && w.state !== "working") {
        rows.push({
          name,
          state: w.state,
          source: "tunes",
          failedTunes: w.failedTunes,
          people: w.people,
          lastFailureAt: w.lastFailureAt,
          lastError: w.lastError,
          retryAt: w.retryAt,
        });
      } else if (viewerSlow.has(key)) {
        const v = viewerSlow.get(key)!;
        rows.push({
          name,
          state: "slow",
          source: "viewers",
          failedTunes: v.runs,
          people: v.people,
          lastFailureAt: v.lastStallAt,
          lastError: null,
          retryAt: v.until,
          corroborated: v.corroborated,
        });
      }
    }
    return { rows: rows.sort((a, b) => (b.lastFailureAt ?? 0) - (a.lastFailureAt ?? 0)), generatedAt: now };
  } catch (err) {
    console.error("[live] notWorkingReport failed:", err);
    return { rows: [], generatedAt: now };
  }
}
