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
import { channelVerdict, liveAliases, streamQualityRank, type ChannelVerdict, type StreamHealth } from "./liveChannelRules";
import { getTodaysFixtures } from "./sportsSchedule";

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
}> {
  const empty = { notResponding: new Set<string>(), quality: new Map<string, number>(), speeds: new Map<string, number>() };
  try {
    const published = await fetchPublishedChannelHealth();
    const at = published?.generatedAt ? Date.parse(published.generatedAt) : NaN;
    if (!published || !Number.isFinite(at) || now - at > HEALTH_TRUST_MS) return empty;
    const quality = new Map<string, number>();
    const speeds = new Map<string, number>();
    for (const [name, h] of published.health) {
      const rank = streamQualityRank(h, now);
      quality.set(name, rank);
      // Only a reading that counted towards the rank is worth showing.
      if (h.speed != null && rank !== 1 && !(h.playable && h.frozen)) speeds.set(name, h.speed);
    }
    return {
      notResponding: new Set([...published.health].filter(([, h]) => !h.playable).map(([name]) => name)),
      quality,
      speeds,
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
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
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
  const live = fixtures ? liveAliases(fixtures) : null;

  const out = new Map<string, ChannelStatus>();
  for (const name of channelNames) {
    const health = published?.health.get(normaliseName(name)) ?? null;
    out.set(name, {
      ...channelVerdict(name, health, live),
      checkedAt: published?.generatedAt ?? null,
    });
  }
  return out;
}
