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
};

type RawStream = {
  id?: number;
  name?: string;
  logo_url?: string | null;
  channel_group?: number | null;
  stream_chno?: number | null;
  is_stale?: boolean;
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

function toStream(s: RawStream): DispatcharrStream | null {
  if (typeof s.id !== "number" || !s.name) return null;
  return {
    id: s.id,
    name: s.name,
    logoUrl: s.logo_url || null,
    groupId: typeof s.channel_group === "number" ? s.channel_group : null,
    suggestedNumber: typeof s.stream_chno === "number" ? s.stream_chno : null,
    stale: !!s.is_stale,
  };
}

export type StreamPage = {
  items: DispatcharrStream[];
  /** Total matching the query, not the page -- the UI needs it for "N results". */
  total: number;
};

/**
 * A page of streams, searched server-side.
 *
 * Server-side because there are 4,150 of them: shipping the whole catalogue to
 * the browser to filter it there would be several megabytes per keystroke, and
 * Dispatcharr already indexes the search.
 */
export async function listStreams(opts: {
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<StreamPage | null> {
  const params = new URLSearchParams({
    page: String(Math.max(1, opts.page ?? 1)),
    page_size: String(Math.min(200, Math.max(1, opts.pageSize ?? 50))),
  });
  const q = opts.search?.trim();
  if (q) params.set("search", q);

  const data = await api<{ count?: number; results?: RawStream[] } | RawStream[]>(
    `/api/channels/streams/?${params.toString()}`
  );
  if (!data) return null;

  const raw = Array.isArray(data) ? data : (data.results ?? []);
  const total = Array.isArray(data) ? raw.length : (data.count ?? raw.length);
  return {
    items: raw.map(toStream).filter((s): s is DispatcharrStream => s != null),
    total,
  };
}

/** Stream ids already promoted, so the browser can mark them rather than offer them twice. */
export async function listPromotedStreamIds(): Promise<Set<number> | null> {
  const data = await api<
    { results?: { streams?: number[] }[] } | { streams?: number[] }[]
  >(`/api/channels/channels/?page_size=1000`);
  if (!data) return null;

  const rows = Array.isArray(data) ? data : (data.results ?? []);
  const ids = new Set<number>();
  for (const row of rows) {
    for (const id of row?.streams ?? []) {
      if (typeof id === "number") ids.add(id);
    }
  }
  return ids;
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
}): Promise<{ id: number } | null> {
  const body: Record<string, unknown> = {
    name: input.name,
    streams: [input.streamId],
  };
  if (typeof input.channelNumber === "number") body.channel_number = input.channelNumber;
  if (typeof input.groupId === "number") body.channel_group_id = input.groupId;

  const created = await api<{ id?: number }>(`/api/channels/channels/`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return typeof created?.id === "number" ? { id: created.id } : null;
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
