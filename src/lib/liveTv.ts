/**
 * Jellyfin Live TV (server-side only).
 *
 * Separate from jellyfin.ts deliberately. That file is about the *library* --
 * finding a movie by TMDB id, resolving a file to a stream. Live TV shares the
 * server and the credential but nothing else: channels aren't library items,
 * there is no TMDB id to match on, and "what is playable" is a question about
 * a broadcast schedule rather than about a file existing on disk.
 *
 * Whether Live TV *works* is answered by asking for channels, not by probing
 * for a tuner. An earlier version here did GET /LiveTv/TunerHosts, which is a
 * POST-only endpoint -- it answers 405, the call threw, and the page reported
 * "no tuner configured" while two tuners sat happily configured in Jellyfin.
 * Channels are also the thing the page actually needs, so asking for them
 * directly cannot be wrong the way an inferred signal can.
 */

const JELLYFIN_URL = process.env.JELLYFIN_URL?.replace(/\/$/, "");
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY;
const JELLYFIN_USER_ID = process.env.JELLYFIN_USER_ID;

const LIVE_TV_TIMEOUT_MS = 25_000;

/**
 * Cap on channels fetched.
 *
 * Jellyfin will enumerate every channel a tuner reports, and a public M3U
 * index can carry five figures of them. Some cap has to exist or the request
 * outruns the timeout.
 *
 * 2000 rather than 500 because 500 silently truncated a real lineup -- the
 * list just stopped, with nothing saying why. The grid handles the size with
 * search and incremental reveal rather than by being handed less data, and the
 * page says plainly when the cap has been hit instead of quietly cutting off.
 */
export const MAX_CHANNELS = 2000;

export type LiveChannel = {
  id: string;
  name: string;
  /** Broadcast channel number ("7.1"), when the tuner reports one. */
  number: string | null;
  /** Streamy-proxied logo URL, or null when the channel has no image. */
  logoUrl: string | null;
  now: LiveProgram | null;
  next: LiveProgram | null;
};

export type LiveProgram = {
  id: string;
  name: string;
  episodeTitle: string | null;
  overview: string | null;
  startUtc: string | null;
  endUtc: string | null;
  isLive: boolean;
  isNews: boolean;
  isSports: boolean;
};

type JfProgram = {
  Id?: string;
  Name?: string;
  EpisodeTitle?: string;
  Overview?: string;
  StartDate?: string;
  EndDate?: string;
  IsLive?: boolean;
  IsNews?: boolean;
  IsSports?: boolean;
};

type JfChannel = {
  Id?: string;
  Name?: string;
  ChannelNumber?: string;
  ImageTags?: Record<string, string>;
  CurrentProgram?: JfProgram;
};

/** Env is present. Says nothing about whether the server is actually up. */
export function isJellyfinConfiguredForLiveTv(): boolean {
  return !!(JELLYFIN_URL && JELLYFIN_API_KEY);
}

/**
 * Whether Jellyfin is actually answering.
 *
 * Env being set is not the same as the server being up, and conflating them
 * produced a genuinely misleading page: with Jellyfin down, /live reported
 * "No tuner configured" -- because the tuner probe threw, was caught, and
 * returned false. That sends you to check the tuner when the real problem is
 * the server, which is the most expensive kind of wrong error message.
 *
 * /System/Info/Public needs no auth and is the cheapest thing Jellyfin serves.
 */
export async function isJellyfinReachable(): Promise<boolean> {
  if (!isJellyfinConfiguredForLiveTv()) return false;
  try {
    const res = await fetch(`${JELLYFIN_URL}/System/Info/Public`, {
      signal: AbortSignal.timeout(LIVE_TV_TIMEOUT_MS),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function liveTvFetch<T>(path: string): Promise<T> {
  return liveTvFetchJson<T>(path);
}

async function liveTvFetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${JELLYFIN_URL}${path}`, {
    ...init,
    headers: { "X-Emby-Token": JELLYFIN_API_KEY!, ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(LIVE_TV_TIMEOUT_MS),
    // A schedule is current-by-definition; a cached guide is a wrong guide.
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Jellyfin Live TV error: ${res.status}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Live TV probes sit on a page load's critical path; a dead tuner must not
 * hang it. Generous because a large playlist is slow to enumerate -- a
 * 10,000-channel M3U is a normal thing for someone to point Jellyfin at.
 */
function toProgram(p: JfProgram | undefined | null): LiveProgram | null {
  if (!p?.Id || !p?.Name) return null;
  return {
    id: p.Id,
    name: p.Name,
    episodeTitle: p.EpisodeTitle || null,
    overview: p.Overview || null,
    startUtc: p.StartDate || null,
    endUtc: p.EndDate || null,
    isLive: !!p.IsLive,
    isNews: !!p.IsNews,
    isSports: !!p.IsSports,
  };
}

/**
 * Channel logo, proxied through Streamy rather than linked directly.
 *
 * Same reason playback is proxied (see jellyfin.ts): JELLYFIN_URL is a
 * Tailscale-only plain-HTTP address. A browser can't route to it, and an HTTPS
 * page couldn't load an HTTP image from it anyway. Linking directly would also
 * put JELLYFIN_API_KEY in markup the client can read.
 */
function logoUrl(channel: JfChannel): string | null {
  const tag = channel.ImageTags?.Primary;
  if (!tag || !channel.Id) return null;
  return `/api/livetv/image/${channel.Id}?tag=${encodeURIComponent(tag)}`;
}

/**
 * Every channel the tuner offers, each with what's on now.
 *
 * AddCurrentProgram lets one request answer both "what channels exist" and
 * "what is on each" -- the alternative is a channel list plus an N-channel
 * guide query, which is a lot of round trips for a grid that is mostly
 * now-playing labels.
 *
 * Returns [] rather than throwing when Live TV is unconfigured or the tuner is
 * unreachable. A dead antenna is a normal state for this feature, not an error
 * the page should blow up on.
 */
export async function getLiveChannels(): Promise<LiveChannel[]> {
  if (!isJellyfinConfiguredForLiveTv()) return [];
  const params = new URLSearchParams({
    EnableImages: "true",
    AddCurrentProgram: "true",
    // Jellyfin sorts by its internal order otherwise, which bears no relation
    // to how anyone thinks about channels.
    SortBy: "SortName",
    SortOrder: "Ascending",
    Limit: String(MAX_CHANNELS),
  });
  if (JELLYFIN_USER_ID) params.set("userId", JELLYFIN_USER_ID);

  try {
    const data = await liveTvFetch<{ Items?: JfChannel[] }>(
      `/LiveTv/Channels?${params.toString()}`
    );
    return (data?.Items ?? [])
      .filter((c): c is JfChannel & { Id: string; Name: string } => !!c.Id && !!c.Name)
      .map((c) => ({
        id: c.Id,
        name: c.Name,
        number: c.ChannelNumber || null,
        logoUrl: logoUrl(c),
        now: toProgram(c.CurrentProgram),
        next: null,
      }));
  } catch {
    return [];
  }
}

/**
 * Fills in the "up next" slot for the channels given.
 *
 * Split from getLiveChannels because it is strictly optional: a tuner with no
 * EPG (an M3U playlist with no XMLTV source, which is exactly the development
 * setup) returns nothing here, and the grid still renders usefully from
 * channel names and current-program data alone. One batched request rather
 * than one per channel.
 */
/**
 * How many channels' guide data to request at once.
 *
 * Jellyfin takes ChannelIds as a comma-separated query parameter, so this is
 * really a limit on URL length. 2000 channel ids is roughly 72KB of query
 * string, well past what most servers accept -- it comes back as a 414 or a
 * connection reset, not as a useful error. A public M3U index makes that the
 * normal case rather than a pathological one.
 */
const GUIDE_BATCH_SIZE = 50;

/**
 * Fills in the "up next" slot for the channels given.
 *
 * Split from getLiveChannels because it is strictly optional: a tuner with no
 * EPG returns nothing here, and the grid still renders usefully from channel
 * names and current-program data alone.
 *
 * Batched rather than one request per channel *or* one request for all of
 * them -- the first is thousands of round trips, the second builds a URL no
 * server will accept. Batches run in parallel and a failed batch costs only
 * its own channels' "next" line.
 */
export async function attachNextPrograms(channels: LiveChannel[]): Promise<LiveChannel[]> {
  if (!isJellyfinConfiguredForLiveTv() || channels.length === 0) return channels;

  const now = new Date();
  const batches: LiveChannel[][] = [];
  for (let i = 0; i < channels.length; i += GUIDE_BATCH_SIZE) {
    batches.push(channels.slice(i, i + GUIDE_BATCH_SIZE));
  }

  const results = await Promise.all(
    batches.map(async (batch) => {
      const params = new URLSearchParams({
        ChannelIds: batch.map((c) => c.id).join(","),
        // From now forward only: a window that starts in the past returns what
        // already aired, and "up next" would show this morning.
        MinStartDate: now.toISOString(),
        MaxStartDate: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
        SortBy: "StartDate",
        SortOrder: "Ascending",
        Limit: String(batch.length * 4),
      });
      if (JELLYFIN_USER_ID) params.set("userId", JELLYFIN_USER_ID);
      try {
        const data = await liveTvFetch<{ Items?: (JfProgram & { ChannelId?: string })[] }>(
          `/LiveTv/Programs?${params.toString()}`
        );
        return data?.Items ?? [];
      } catch {
        // One batch failing costs those channels their "next" line, not the
        // whole page.
        return [];
      }
    })
  );

  return mergeNextPrograms(channels, results.flat());
}

/** Raw Jellyfin URL for a channel logo -- only ever reached via the image proxy. */
export function channelImageUpstreamUrl(channelId: string, tag: string): string {
  const params = new URLSearchParams({ tag, api_key: JELLYFIN_API_KEY ?? "" });
  return `${JELLYFIN_URL}/Items/${channelId}/Images/Primary?${params.toString()}`;
}


/**
 * Pairs each channel with the first guide entry that is genuinely *next*.
 *
 * Pure, so it tests without a Jellyfin server.
 *
 * The subtlety is that the guide query legitimately returns the programme
 * already showing as "now" -- it hasn't ended, so it matches a window that
 * starts now. Taking the first entry per channel blindly renders the same
 * title on both lines, which reads as a bug in the guide rather than as an
 * accurate statement about a long programme.
 */
export function mergeNextPrograms(
  channels: LiveChannel[],
  items: (JfProgram & { ChannelId?: string })[]
): LiveChannel[] {
  const nextByChannel = new Map<string, LiveProgram>();
  const nowIdByChannel = new Map(channels.map((c) => [c.id, c.now?.id ?? null]));

  for (const item of items) {
    const chId = item.ChannelId;
    if (!chId || nextByChannel.has(chId)) continue;
    if (!nowIdByChannel.has(chId)) continue;
    if (item.Id && nowIdByChannel.get(chId) === item.Id) continue;
    const prog = toProgram(item);
    if (prog) nextByChannel.set(chId, prog);
  }

  return channels.map((c) => ({ ...c, next: nextByChannel.get(c.id) ?? null }));
}


export type LiveStreamHandle = {
  /** The opened stream's media source id -- NOT the channel id. */
  mediaSourceId: string;
  /** Ties every subsequent request to this one viewing. */
  playSessionId: string;
};

/**
 * Opens a live stream for a channel and returns what the transcode needs to
 * address it.
 *
 * A recorded title has one media source and Jellyfin tolerates being handed
 * the item id in its place. A channel does not: asking for it tells Jellyfin
 * to *tune* -- allocate a tuner, start pulling the broadcast -- and it answers
 * with an id for that live stream, which every later request has to name.
 *
 * POST, with an empty body, deliberately: PlaybackInfo has a GET form that
 * returns media sources without opening anything, which looks like it works
 * right up until the transcode has nothing to read from.
 *
 * Returns null rather than throwing on failure. A channel that won't tune is
 * an ordinary outcome here -- the tuner is busy, the upstream is down, the
 * playlist entry is dead -- and the page says so instead of erroring.
 */
export async function openLiveStream(channelId: string): Promise<LiveStreamHandle | null> {
  if (!isJellyfinConfiguredForLiveTv()) return null;

  const playSessionId = crypto.randomUUID();
  const params = new URLSearchParams({ PlaySessionId: playSessionId });
  if (JELLYFIN_USER_ID) params.set("UserId", JELLYFIN_USER_ID);

  try {
    const data = await liveTvFetchJson<{
      MediaSources?: { Id?: string; OpenToken?: string }[];
      PlaySessionId?: string;
    }>(`/Items/${encodeURIComponent(channelId)}/PlaybackInfo?${params.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    const mediaSourceId = data?.MediaSources?.[0]?.Id;
    if (!mediaSourceId) return null;
    return { mediaSourceId, playSessionId: data?.PlaySessionId || playSessionId };
  } catch {
    return null;
  }
}


/**
 * One channel by id, with what's on now.
 *
 * Asks for the whole lineup and picks, rather than fetching the channel
 * directly: Jellyfin's per-item endpoint returns a library item without
 * CurrentProgram, so a channel page built on it would have the stream but no
 * idea what was showing. The lineup response is already the shape the grid
 * uses, and Jellyfin caches its tuner lookup between calls.
 */
export async function getLiveChannel(channelId: string): Promise<LiveChannel | null> {
  const channels = await getLiveChannels();
  return channels.find((c) => c.id === channelId) ?? null;
}
