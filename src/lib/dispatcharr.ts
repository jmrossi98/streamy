/**
 * Dispatcharr API client (server-side only).
 *
 * Dispatcharr holds two different things, and the distinction is the whole
 * reason this file exists:
 *
 *   - STREAMS: everything the configured providers carry. 4,150 of them here.
 *   - CHANNELS: the curated, numbered lineup it publishes to Jellyfin.
 *
 * Only channels reach Jellyfin, and therefore only channels reach Streamy's
 * Live TV tab. Promoting a stream to a channel was previously something you
 * could only do in Dispatcharr's own admin UI, which is why a library of 4,150
 * streams was being watched through a lineup of five.
 *
 * Auth is JWT rather than an API key: POST credentials to get an access token,
 * which expires. The token is cached in module scope and re-fetched on a 401,
 * so a normal request costs one round trip and an expiry costs two.
 */

import { looksLikeNetworkFeed, looksLikePlaceholder } from "@/lib/liveTimeline";

const DISPATCHARR_URL = process.env.DISPATCHARR_URL?.replace(/\/$/, "");
const DISPATCHARR_USER = process.env.DISPATCHARR_USER;
const DISPATCHARR_PASSWORD = process.env.DISPATCHARR_PASSWORD;

/**
 * Dispatcharr runs on the home box, reached over the tailnet. Same reasoning as
 * jellyfin.ts: a call with no deadline holds a Node request open, and Node
 * serves every visitor from one event loop.
 */
const DISPATCHARR_TIMEOUT_MS = 15_000;

export function isDispatcharrConfigured(): boolean {
  return !!(DISPATCHARR_URL && DISPATCHARR_USER && DISPATCHARR_PASSWORD);
}

export type DispatcharrStream = {
  id: number;
  name: string;
  /** Provider's own logo, when it supplies one. */
  logoUrl: string | null;
  /** Provider group id -- Dispatcharr's own grouping, not Streamy's category. */
  groupId: number | null;
  /** Channel number the provider suggests, when it supplies one. */
  suggestedNumber: number | null;
  /**
   * Dispatcharr's own judgement that this stream has stopped working.
   *
   * Worth surfacing rather than hiding: two of the five channels already
   * promoted here have dead upstreams, and a lineup that silently includes
   * them is how "live TV is broken" gets reported when only one channel is.
   */
  stale: boolean;
  /**
   * The provider's own XMLTV channel id for this stream ("NBCSportsWashington.us"),
   * when it supplies one -- confirmed present on both configured providers here.
   * What promoteStreamToChannel uses to resolve EPG automatically; see its own
   * comment for why this is worth doing over Dispatcharr's fuzzy name-based
   * Auto-Match.
   */
  tvgId: string | null;
  /** Which configured provider ("strong8k", "trex") this stream is from. */
  provider: string | null;
};

type RawStream = {
  id?: number;
  name?: string;
  m3u_account?: number;
  logo_url?: string | null;
  channel_group?: number | null;
  stream_chno?: number | null;
  is_stale?: boolean;
  tvg_id?: string | null;
};

/** Cached access token. Dispatcharr's JWT is short-lived; 401 means refetch. */
let cachedToken: string | null = null;

async function fetchToken(): Promise<string | null> {
  try {
    const res = await fetch(`${DISPATCHARR_URL}/api/accounts/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: DISPATCHARR_USER,
        password: DISPATCHARR_PASSWORD,
      }),
      signal: AbortSignal.timeout(DISPATCHARR_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access?: string };
    cachedToken = data?.access ?? null;
    return cachedToken;
  } catch {
    return null;
  }
}

/**
 * One authenticated request, retrying once through a fresh token.
 *
 * The retry is specifically for 401 and happens exactly once: a wrong password
 * would otherwise turn every call into two, and would look like a slow service
 * rather than a misconfigured one.
 */
async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (!isDispatcharrConfigured()) return null;

  const call = async (token: string) =>
    fetch(`${DISPATCHARR_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(DISPATCHARR_TIMEOUT_MS),
      cache: "no-store",
    });

  try {
    let token = cachedToken ?? (await fetchToken());
    if (!token) return null;

    let res = await call(token);
    if (res.status === 401) {
      cachedToken = null;
      token = await fetchToken();
      if (!token) return null;
      res = await call(token);
    }
    if (!res.ok) return null;

    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  } catch {
    return null;
  }
}

function toStream(s: RawStream, accountNameById?: Map<number, string>): DispatcharrStream | null {
  if (typeof s.id !== "number" || !s.name) return null;
  return {
    id: s.id,
    name: s.name,
    logoUrl: s.logo_url || null,
    groupId: typeof s.channel_group === "number" ? s.channel_group : null,
    suggestedNumber: typeof s.stream_chno === "number" ? s.stream_chno : null,
    stale: !!s.is_stale,
    tvgId: s.tvg_id || null,
    provider: typeof s.m3u_account === "number" ? (accountNameById?.get(s.m3u_account) ?? null) : null,
  };
}

/** Every configured M3U provider's own name, keyed by its Dispatcharr id. */
async function getAccountNameById(): Promise<Map<number, string>> {
  const data = await api<{ results?: { id?: number; name?: string }[] } | { id?: number; name?: string }[]>(
    `/api/m3u/accounts/`
  );
  const map = new Map<number, string>();
  if (!data) return map;
  for (const a of Array.isArray(data) ? data : (data.results ?? [])) {
    if (typeof a.id === "number" && a.name) map.set(a.id, a.name);
  }
  return map;
}

export type StreamPage = {
  items: DispatcharrStream[];
  /** Total matching the query, not the page -- the UI needs it for "N results". */
  total: number;
};

/**
 * Upper bound for a "fetch the whole matching set" call.
 *
 * Comfortably above the full catalogue (4,150 measured) so one request covers
 * it, without being unbounded -- Dispatcharr's own page_size accepts far larger
 * values (confirmed against /api/epg/epgdata/ during the EPG investigation),
 * but nothing here needs more than "everything there currently is".
 */
const FULL_CATALOGUE_PAGE_SIZE = 10_000;

/**
 * A page of streams, searched server-side.
 *
 * Server-side because there are 4,150 of them: shipping the whole catalogue to
 * the browser to filter it there would be several megabytes per keystroke, and
 * Dispatcharr already indexes the search.
 *
 * `networksOnly` filters by `looksLikeNetworkFeed` *before* paginating, not
 * after. Filtering the browser's own 50-item page client-side (the original
 * approach) left `total`/page-count reflecting the unfiltered search while
 * each page displayed only however many of its 50 happened to be networks --
 * on the full catalogue, page after page could come back holding two or three
 * rows, or none, against 83 pages of button. Doing it here means one larger
 * upstream fetch (the whole matching set, not just one page) so the pagination
 * this returns is honest about what it is paginating.
 */
export async function listStreams(opts: {
  search?: string;
  page?: number;
  pageSize?: number;
  networksOnly?: boolean;
}): Promise<StreamPage | null> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
  const q = opts.search?.trim();
  // Fetched alongside the search itself either way, not just when it turns
  // out to be needed -- both branches below map every returned row through
  // toStream(), which wants this to resolve `provider`.
  const accountNameById = await getAccountNameById();

  if (opts.networksOnly) {
    const params = new URLSearchParams({ page: "1", page_size: String(FULL_CATALOGUE_PAGE_SIZE) });
    if (q) params.set("search", q);

    const data = await api<{ count?: number; results?: RawStream[] } | RawStream[]>(
      `/api/channels/streams/?${params.toString()}`
    );
    if (!data) return null;

    const raw = Array.isArray(data) ? data : (data.results ?? []);
    const filtered = raw
      .map((s) => toStream(s, accountNameById))
      .filter(
        (s): s is DispatcharrStream =>
          s != null && !looksLikePlaceholder(s.name) && looksLikeNetworkFeed(s.name)
      );

    const start = (page - 1) * pageSize;
    return { items: filtered.slice(start, start + pageSize), total: filtered.length };
  }

  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (q) params.set("search", q);

  const data = await api<{ count?: number; results?: RawStream[] } | RawStream[]>(
    `/api/channels/streams/?${params.toString()}`
  );
  if (!data) return null;

  const raw = Array.isArray(data) ? data : (data.results ?? []);
  // `total` stays Dispatcharr's own count, deliberately. This branch
  // paginates server-side, so placeholders can only be dropped from the page
  // actually in hand -- a page of 50 may render 48. Correcting the total
  // would mean fetching the whole matching set on every keystroke (what the
  // networksOnly branch above does, and why it has to) for a cosmetic
  // difference of a row or two.
  const total = Array.isArray(data) ? raw.length : (data.count ?? raw.length);
  return {
    items: raw
      .map((s) => toStream(s, accountNameById))
      .filter((s): s is DispatcharrStream => s != null && !looksLikePlaceholder(s.name)),
    total,
  };
}

/**
 * Stream id -> the channel id publishing it, so the browser can both mark a
 * stream as already promoted (rather than offer it twice) and let an admin
 * demote it -- which needs the channel id, not the stream id; Dispatcharr
 * deletes channels, not the promotion itself.
 *
 * A stream promoted under more than one channel is possible but not sensible
 * (two lineup entries for the same feed), so the last channel seen simply
 * wins; nothing here depends on picking a particular one.
 */
export async function listPromotedStreamIds(): Promise<Map<number, number> | null> {
  const data = await api<
    | { results?: { id?: number; streams?: number[] }[] }
    | { id?: number; streams?: number[] }[]
  >(`/api/channels/channels/?page_size=1000`);
  if (!data) return null;

  const rows = Array.isArray(data) ? data : (data.results ?? []);
  const byStreamId = new Map<number, number>();
  for (const row of rows) {
    if (typeof row?.id !== "number") continue;
    for (const streamId of row.streams ?? []) {
      if (typeof streamId === "number") byStreamId.set(streamId, row.id);
    }
  }
  return byStreamId;
}

/**
 * Finds or creates a logo record, returning its id.
 *
 * Dispatcharr stores logos as their own rows and channels reference one by id,
 * so a channel cannot simply carry a URL. Every provider stream ships a
 * `logo_url` -- 200 of 200 sampled here -- but the five published channels had
 * `logo_id: null`, so Dispatcharr emitted `tvg-logo=""` in its M3U, Jellyfin
 * had no image to cache, and Streamy fell back to drawing the channel's
 * initials in a grey box.
 *
 * Existing logos are reused by URL rather than duplicated: promoting six
 * streams from one provider otherwise creates six identical rows.
 */
export async function ensureLogo(name: string, url: string): Promise<number | null> {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const existing = await api<
    { results?: { id?: number | string; url?: string }[] } | { id?: number | string; url?: string }[]
  >(`/api/channels/logos/?page_size=1000`);
  const rows = existing ? (Array.isArray(existing) ? existing : (existing.results ?? [])) : [];
  const match = rows.find((r) => r?.url === trimmed);
  if (match?.id != null) {
    const id = Number(match.id);
    if (Number.isFinite(id)) return id;
  }

  const created = await api<{ id?: number | string }>(`/api/channels/logos/`, {
    method: "POST",
    body: JSON.stringify({ name: name.slice(0, 100), url: trimmed }),
  });
  const id = Number(created?.id);
  return Number.isFinite(id) ? id : null;
}

/** One published channel, for backfilling artwork onto what already exists. */
export type DispatcharrChannel = {
  id: number;
  name: string;
  logoId: number | null;
  streamIds: number[];
};

export async function listChannels(): Promise<DispatcharrChannel[] | null> {
  const data = await api<
    | { results?: { id?: number; name?: string; logo_id?: number | null; streams?: number[] }[] }
    | { id?: number; name?: string; logo_id?: number | null; streams?: number[] }[]
  >(`/api/channels/channels/?page_size=1000`);
  if (!data) return null;
  const rows = Array.isArray(data) ? data : (data.results ?? []);
  return rows
    .filter((r): r is { id: number; name: string; logo_id?: number | null; streams?: number[] } =>
      typeof r?.id === "number" && typeof r?.name === "string"
    )
    .map((r) => ({
      id: r.id,
      name: r.name,
      logoId: typeof r.logo_id === "number" ? r.logo_id : null,
      streamIds: r.streams ?? [],
    }));
}

/**
 * Dispatcharr's numeric channel id for a channel Jellyfin already knows by
 * name.
 *
 * Jellyfin's Live TV API (what the channel page renders from) only ever
 * hands back its own GUID-like id, never Dispatcharr's -- the two systems
 * are correlated by name alone, via the M3U Dispatcharr publishes and
 * Jellyfin tunes to (see getMappedChannelPrograms' own comment on the same
 * point). Demoting needs Dispatcharr's id specifically, so a channel page
 * that wants to offer it has to look the name up here first.
 */
export async function findChannelIdByName(name: string): Promise<number | null> {
  const channels = await listChannels();
  return channels?.find((c) => c.name === name)?.id ?? null;
}

/**
 * Every published channel's provider name ("strong8k", "trex"), keyed by
 * channel name -- same key convention as getMappedChannelPrograms and
 * findChannelIdByName, for the same reason: Jellyfin's Live TV API (what
 * every channel-rendering caller actually has) only ever knows a channel by
 * name, never Dispatcharr's id.
 *
 * Two providers can carry the same-looking content at very different
 * reliability (confirmed live 2026-09-20/21: strong8k got Cloudflare-
 * blocked twice in one evening, trex stayed up throughout), so which one a
 * channel is actually on is worth showing, not just implied by its name.
 *
 * `include_streams=true` gets each channel's stream(s) inline in the same
 * request rather than N follow-up calls per channel -- confirmed live this
 * parameter exists and returns full stream objects (each carrying its own
 * `m3u_account` id), not just the id list `listChannels()` reads.
 * Multi-stream channels (a primary plus manually-added fallbacks) take the
 * first stream's provider, since that is Dispatcharr's own default pick.
 */
export async function getChannelProviders(): Promise<Map<string, string> | null> {
  const [channelsData, accountNameById] = await Promise.all([
    api<
      | { results?: { name?: string; streams?: { m3u_account?: number }[] }[] }
      | { name?: string; streams?: { m3u_account?: number }[] }[]
    >(`/api/channels/channels/?page_size=1000&include_streams=true`),
    getAccountNameById(),
  ]);
  if (!channelsData) return null;

  const result = new Map<string, string>();
  for (const c of Array.isArray(channelsData) ? channelsData : (channelsData.results ?? [])) {
    const accountId = c.streams?.[0]?.m3u_account;
    const providerName = typeof accountId === "number" ? accountNameById.get(accountId) : undefined;
    if (c.name && providerName) result.set(c.name, providerName);
  }
  return result;
}

export type ChannelProgram = {
  title: string;
  description: string;
  startUtc: string;
  endUtc: string;
};

/**
 * Real EPG programme data for whichever published channels happen to be
 * mapped to a real EPG source entry, keyed by the channel's own name --
 * which is what a fixture-matching caller actually has to key off of, since
 * Jellyfin's channel list (what the rest of Live TV works from) carries the
 * same names via the M3U Dispatcharr publishes, not Dispatcharr's channel
 * ids.
 *
 * Most published channels have no such mapping. Dispatcharr's EPG source
 * here only carries a small slice of the underlying catalogue, mapping is a
 * manual per-channel step, and a fixture-named channel (a promoted
 * single-team stream) essentially never has a real listing of its own to
 * map to -- so this returns data only for the channels that do, which today
 * is a small, deliberately-curated set. Returns null only when Dispatcharr
 * itself couldn't be read; an empty map (nothing mapped) is a normal answer.
 *
 * Three separate lists combined client-side rather than one filtered call:
 * Dispatcharr's `epg_data` query param on `/api/epg/programs/` is
 * documented to filter but does not -- confirmed live, a real id and a
 * nonexistent one return the identical, unfiltered set. Every list here is
 * already this small (the point above), so filtering after one full fetch
 * of each costs nothing extra.
 */
export async function getMappedChannelPrograms(): Promise<Map<string, ChannelProgram[]> | null> {
  const [channelsData, epgData, programsData] = await Promise.all([
    api<
      | { results?: { id?: number; name?: string; epg_data_id?: number | null }[] }
      | { id?: number; name?: string; epg_data_id?: number | null }[]
    >(`/api/channels/channels/?page_size=1000`),
    api<{ results?: { id?: number; tvg_id?: string }[] } | { id?: number; tvg_id?: string }[]>(
      `/api/epg/epgdata/?page_size=5000`
    ),
    api<
      | {
          results?: {
            title?: string;
            description?: string;
            start_time?: string;
            end_time?: string;
            tvg_id?: string;
          }[];
        }
      | { title?: string; description?: string; start_time?: string; end_time?: string; tvg_id?: string }[]
    >(`/api/epg/programs/?page_size=5000`),
  ]);
  if (!channelsData || !epgData || !programsData) return null;

  const channels = Array.isArray(channelsData) ? channelsData : (channelsData.results ?? []);
  const epgRows = Array.isArray(epgData) ? epgData : (epgData.results ?? []);
  const programs = Array.isArray(programsData) ? programsData : (programsData.results ?? []);

  const tvgIdByEpgDataId = new Map<number, string>();
  for (const row of epgRows) {
    if (typeof row.id === "number" && row.tvg_id) tvgIdByEpgDataId.set(row.id, row.tvg_id);
  }

  const programsByTvgId = new Map<string, ChannelProgram[]>();
  for (const p of programs) {
    if (!p.tvg_id || !p.title || !p.start_time || !p.end_time) continue;
    const list = programsByTvgId.get(p.tvg_id) ?? [];
    list.push({
      title: p.title,
      description: p.description ?? "",
      startUtc: p.start_time,
      endUtc: p.end_time,
    });
    programsByTvgId.set(p.tvg_id, list);
  }

  const result = new Map<string, ChannelProgram[]>();
  for (const c of channels) {
    if (typeof c.id !== "number" || !c.name || typeof c.epg_data_id !== "number") continue;
    const tvgId = tvgIdByEpgDataId.get(c.epg_data_id);
    const channelPrograms = tvgId ? programsByTvgId.get(tvgId) : undefined;
    if (channelPrograms) result.set(c.name, channelPrograms);
  }
  return result;
}

/** One stream by id, so a channel can borrow its artwork. */
export async function getStream(id: number): Promise<DispatcharrStream | null> {
  const raw = await api<RawStream>(`/api/channels/streams/${id}/`);
  return raw ? toStream(raw) : null;
}

/** Points an existing channel at a logo. */
export async function setChannelLogo(channelId: number, logoId: number): Promise<boolean> {
  const res = await api<{ id?: number }>(`/api/channels/channels/${channelId}/`, {
    method: "PATCH",
    body: JSON.stringify({ logo_id: logoId }),
  });
  return res != null;
}

/**
 * Dispatcharr's own EPGData row id for a provider's XMLTV channel id
 * ("NBCSportsWashington.us"), across every configured EPG source.
 *
 * The alternative -- Dispatcharr's fuzzy name-matching "Auto-Match" -- misses
 * real matches constantly: confirmed live against this exact catalogue that
 * "SP - NHL NETWORK HD" and "SP - NBA TV HD" both had exact EPGData rows
 * (via their stream's own tvg_id) that Auto-Match, bulk or per-channel,
 * failed to find. tvg_id is an exact identifier the provider already
 * supplies; there is no guessing involved once it's known.
 *
 * Fetches the whole table rather than filtering server-side: confirmed live
 * that `/api/epg/epgdata/`'s own query params (page_size included) are
 * ignored and it always returns everything regardless, the same undocumented
 * behaviour already known from `/api/epg/programs/`'s epg_data filter (see
 * getMappedChannelPrograms). 8,415 rows measured on this catalogue -- cheap
 * enough for the one-off cost of a promote, not something to cache, since a
 * newly-added EPG source's rows need to be visible on the very next promote
 * rather than behind a stale cache.
 */
async function findEpgDataIdByTvgId(tvgId: string): Promise<number | null> {
  const data = await api<{ results?: { id?: number; tvg_id?: string }[] } | { id?: number; tvg_id?: string }[]>(
    `/api/epg/epgdata/`
  );
  if (!data) return null;
  const rows = Array.isArray(data) ? data : (data.results ?? []);
  const match = rows.find((r) => r.tvg_id === tvgId);
  return typeof match?.id === "number" ? match.id : null;
}

/**
 * Promotes a stream into the published lineup.
 *
 * `name` is the only field Dispatcharr requires. The channel number is chosen
 * here rather than left to Dispatcharr: it assigns nothing by default, and a
 * lineup of channels all numbered zero sorts arbitrarily in every client that
 * shows it.
 *
 * Returns the new channel id, or null. Deliberately not throwing: a failed
 * promote is an ordinary outcome (a duplicate name, a stream deleted upstream
 * between listing and clicking) and the panel says so rather than erroring.
 */
export async function promoteStreamToChannel(input: {
  streamId: number;
  name: string;
  channelNumber?: number | null;
  groupId?: number | null;
  /** The provider's logo for this stream, attached to the new channel. */
  logoUrl?: string | null;
}): Promise<{ id: number } | null> {
  const body: Record<string, unknown> = {
    name: input.name,
    streams: [input.streamId],
  };
  if (typeof input.channelNumber === "number") body.channel_number = input.channelNumber;
  if (typeof input.groupId === "number") body.channel_group_id = input.groupId;

  // Artwork, when the provider supplied any. Best effort on purpose: a channel
  // with no logo is a cosmetic problem, and failing the whole promote over one
  // would be worse than the grey box it avoids.
  if (input.logoUrl) {
    const logoId = await ensureLogo(input.name, input.logoUrl);
    if (logoId != null) body.logo_id = logoId;
  }

  // EPG, resolved from the stream's own tvg_id rather than left to
  // Dispatcharr's fuzzy Auto-Match -- see findEpgDataIdByTvgId's own comment
  // for why that misses real matches this doesn't. Best effort, same
  // reasoning as the logo above: a channel that lands with no programme
  // guide is a lesser problem than a promote failing outright over it.
  const stream = await getStream(input.streamId);
  if (stream?.tvgId) {
    const epgDataId = await findEpgDataIdByTvgId(stream.tvgId);
    if (epgDataId != null) body.epg_data_id = epgDataId;
  }

  const created = await api<{ id?: number }>(`/api/channels/channels/`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return typeof created?.id === "number" ? { id: created.id } : null;
}

/**
 * Removes a channel from the published lineup.
 *
 * A demote, not a delete of anything the provider owns: a Dispatcharr channel
 * is its own record that merely references a stream id, so removing it
 * leaves the underlying stream exactly where it was in the catalogue --
 * unpublished, still visible in Browse all streams, promotable again later.
 * Nothing about the provider's own listing is touched.
 *
 * Returns whether the delete succeeded. Deliberately not throwing, same
 * reasoning as promoteStreamToChannel: a channel already gone (removed by
 * someone else, or directly in Dispatcharr, between the admin's page load
 * and their click) is an ordinary outcome for the panel to report, not an
 * exception -- though in that specific case Dispatcharr 404s and this
 * reports it as a failure to remove, which is honest: nothing was removed
 * *by this call*, it was already gone.
 */
export async function demoteChannel(channelId: number): Promise<boolean> {
  const res = await api<unknown>(`/api/channels/channels/${channelId}/`, {
    method: "DELETE",
  });
  // api() returns undefined (not null) for a 204's empty body, same as any
  // other successful-but-bodyless response -- only a genuine failure is null.
  return res !== null;
}

/**
 * The next free channel number.
 *
 * Read rather than guessed: Dispatcharr accepts duplicates, and two channels
 * sharing a number is the kind of thing that looks fine until a client sorts
 * by it.
 */
export async function nextChannelNumber(): Promise<number> {
  const data = await api<
    { results?: { channel_number?: number }[] } | { channel_number?: number }[]
  >(`/api/channels/channels/?page_size=1000`);
  const rows = data ? (Array.isArray(data) ? data : (data.results ?? [])) : [];
  const highest = rows.reduce((max, r) => {
    const n = r?.channel_number;
    return typeof n === "number" && n > max ? n : max;
  }, 0);
  // Whole numbers only: broadcast-style decimals (7.1) are meaningful and
  // should not be produced by accident.
  return Math.floor(highest) + 1;
}
