/**
 * Minimal qBittorrent client (server-side only). Optional: set
 * QBITTORRENT_URL/QBITTORRENT_USER/QBITTORRENT_PASSWORD to enable.
 *
 * Radarr and Sonarr stop tracking a torrent the moment they import it, so
 * deleting a title through them removes the library file but leaves the
 * torrent seeding in the client -- the title disappears from Streamy while
 * still sitting in qBittorrent. This exists purely so a delete can finish the
 * job. When it isn't configured, deletes still work; leftover torrents are
 * then cleaned up by qBittorrent's own share limits instead.
 */

import { mustKeepSeeding } from "./privateSeedRules";

const QBITTORRENT_URL = process.env.QBITTORRENT_URL?.replace(/\/$/, "");
const QBITTORRENT_USER = process.env.QBITTORRENT_USER;
const QBITTORRENT_PASSWORD = process.env.QBITTORRENT_PASSWORD;

export function isQbittorrentConfigured(): boolean {
  return !!(QBITTORRENT_URL && QBITTORRENT_USER && QBITTORRENT_PASSWORD);
}

/** qBittorrent rejects API calls whose Referer isn't its own origin. */
function baseHeaders(): Record<string, string> {
  return { Referer: QBITTORRENT_URL! };
}

async function login(): Promise<string | null> {
  try {
    const res = await fetch(`${QBITTORRENT_URL}/api/v2/auth/login`, {
      method: "POST",
      headers: { ...baseHeaders(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: QBITTORRENT_USER!,
        password: QBITTORRENT_PASSWORD!,
      }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    // The session cookie name is port-suffixed (QBT_SID_8080), so match loosely.
    const cookie = res.headers.get("set-cookie");
    const match = cookie?.match(/(QBT_SID[^=]*=[^;]+)/);
    return match?.[1] ?? null;
  } catch (err) {
    console.error("[qbittorrent] login failed:", err);
    return null;
  }
}

/**
 * Removes torrents by infohash, along with their files.
 *
 * Safe next to the library: imports are hardlinked, so the library keeps its
 * own link to the same data and only the torrent's link goes away. Hashes
 * come from Radarr/Sonarr history (`downloadId`), so this only ever touches
 * torrents Streamy itself caused.
 */
export async function deleteTorrents(hashes: string[]): Promise<boolean> {
  if (!isQbittorrentConfigured() || hashes.length === 0) return false;
  // A private tracker's torrent that hasn't met its seeding rule is moved to
  // seed-only instead of deleted -- see privateSeedRules.ts. Every caller gets
  // this, so no delete path can earn a hit-and-run.
  const held = await heldForSeeding(hashes);
  if (held === null) return false;
  if (held.size > 0) {
    await moveToSeedOnly([...held]);
    hashes = hashes.filter((h) => !held.has(h.toLowerCase()));
    if (hashes.length === 0) return true;
  }
  const cookie = await login();
  if (!cookie) return false;

  try {
    const res = await fetch(`${QBITTORRENT_URL}/api/v2/torrents/delete`, {
      method: "POST",
      headers: {
        ...baseHeaders(),
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      // qBittorrent matches hashes case-insensitively but expects lowercase.
      body: new URLSearchParams({
        hashes: hashes.map((h) => h.toLowerCase()).join("|"),
        deleteFiles: "true",
      }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch (err) {
    console.error("[qbittorrent] deleteTorrents failed:", err);
    return false;
  }
}

/** The category a private torrent goes to when nothing wants it but its tracker still does. */
export const SEED_ONLY_CATEGORY = "private-seed";

type RawTorrent = {
  hash?: string;
  private?: boolean;
  progress?: number;
  ratio?: number;
  seeding_time?: number;
  downloaded?: number;
  uploaded?: number;
};

async function qbit(path: string, form?: Record<string, string>): Promise<Response | null> {
  const cookie = await login();
  if (!cookie) return null;
  try {
    return await fetch(`${QBITTORRENT_URL}${path}`, {
      method: form ? "POST" : "GET",
      headers: {
        ...baseHeaders(),
        Cookie: cookie,
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error(`[qbittorrent] ${path} failed:`, err);
    return null;
  }
}

/**
 * Which of these torrents a private tracker still needs seeded, lowercase.
 * Null when qBittorrent can't be read -- callers must then not delete
 * anything, since "couldn't tell" is not "safe".
 */
export async function heldForSeeding(hashes: string[]): Promise<Set<string> | null> {
  if (!isQbittorrentConfigured()) return new Set();
  const wanted = hashes.map((h) => h.toLowerCase()).filter(Boolean);
  if (wanted.length === 0) return new Set();
  const res = await qbit(`/api/v2/torrents/info?hashes=${wanted.join("|")}`);
  if (!res?.ok) return null;
  const rows = (await res.json()) as RawTorrent[];
  return new Set(
    rows
      .filter((t) =>
        mustKeepSeeding({
          isPrivate: t.private === true,
          progress: t.progress ?? 0,
          ratio: t.ratio ?? 0,
          seedingTime: t.seeding_time ?? 0,
          downloaded: t.downloaded ?? 0,
          uploaded: t.uploaded ?? 0,
        })
      )
      .map((t) => (t.hash ?? "").toLowerCase())
  );
}

/**
 * Takes torrents out of Sonarr's and Radarr's categories and keeps them
 * seeding: mediabox's private-seed-guard keeps them forced active and removes
 * them once their tracker's rule is met.
 */
export async function moveToSeedOnly(hashes: string[]): Promise<void> {
  if (hashes.length === 0) return;
  await qbit("/api/v2/torrents/createCategory", { category: SEED_ONLY_CATEGORY, savePath: "" });
  await qbit("/api/v2/torrents/setCategory", { hashes: hashes.join("|"), category: SEED_ONLY_CATEGORY });
  await qbit("/api/v2/torrents/start", { hashes: hashes.join("|") });
  console.log(`[qbittorrent] kept ${hashes.length} private torrent(s) seeding for their tracker`);
}

/**
 * What to pass as `removeFromClient` when taking a download out of Sonarr's or
 * Radarr's queue. False for a private torrent that still owes seeding (and it
 * is moved to seed-only once the queue entry is gone -- call the returned
 * `after`), and also false when qBittorrent can't be read, for the same
 * reason deleteTorrents refuses then.
 */
export async function clientRemoval(downloadId: string | null | undefined): Promise<{ removeFromClient: boolean; after: () => Promise<void> }> {
  const none = { removeFromClient: true, after: async () => undefined };
  if (!downloadId || !isQbittorrentConfigured()) return none;
  const held = await heldForSeeding([downloadId]);
  if (held === null) return { removeFromClient: false, after: async () => undefined };
  if (held.size === 0) return none;
  return { removeFromClient: false, after: () => moveToSeedOnly([downloadId.toLowerCase()]) };
}

/** One torrent, reduced to what a health check needs. */
export type TorrentHealth = {
  /** Info hash, lowercase -- what Sonarr/Radarr report as the downloadId. */
  hash: string;
  name: string;
  state: string;
  progress: number;
  connectedSeeds: number;
  swarmSeeds: number;
  dlSpeed: number;
  /** When a piece last moved, in unix seconds. */
  lastActivityAt?: number | null;
  /** The client category: "tv-sonarr", "radarr", ... */
  category?: string;
  /** When it was added, in unix seconds. */
  addedOn?: number | null;
};

/**
 * Every torrent's state, for the stalled-download check.
 *
 * Deliberately separate from the *arrs' own queue view. Radarr reports a
 * download as "downloading" right up until its own timeout, which is why a
 * torrent can sit at 8% overnight and nothing anywhere says a word. The
 * client is the only thing that knows it has one connected seed out of five.
 */
export async function getTorrentHealth(): Promise<TorrentHealth[] | null> {
  if (!isQbittorrentConfigured()) return null;
  const cookie = await login();
  if (!cookie) return null;
  try {
    const res = await fetch(`${QBITTORRENT_URL}/api/v2/torrents/info`, {
      headers: { ...baseHeaders(), Cookie: cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      hash?: string;
      name?: string;
      state?: string;
      progress?: number;
      num_seeds?: number;
      num_complete?: number;
      dlspeed?: number;
      last_activity?: number;
      category?: string;
      added_on?: number;
    }[];
    return body.map((t) => ({
      hash: (t.hash ?? "").toLowerCase(),
      name: t.name ?? "(unnamed)",
      state: t.state ?? "unknown",
      progress: t.progress ?? 0,
      connectedSeeds: t.num_seeds ?? 0,
      swarmSeeds: t.num_complete ?? 0,
      dlSpeed: t.dlspeed ?? 0,
      lastActivityAt: t.last_activity && t.last_activity > 0 ? t.last_activity : null,
      category: t.category ?? "",
      addedOn: t.added_on && t.added_on > 0 ? t.added_on : null,
    }));
  } catch (err) {
    console.error("[qbittorrent] torrent health read failed:", err);
    return null;
  }
}

/** qBittorrent's view of its own network, from /api/v2/transfer/info. */
export type TorrentNetwork = {
  connectionStatus: string;
  dhtNodes: number;
};

/** Whether qBittorrent can reach the outside at all. Null when unreadable. */
export async function getTorrentNetwork(): Promise<TorrentNetwork | null> {
  if (!isQbittorrentConfigured()) return null;
  const cookie = await login();
  if (!cookie) return null;
  try {
    const res = await fetch(`${QBITTORRENT_URL}/api/v2/transfer/info`, {
      headers: { ...baseHeaders(), Cookie: cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { connection_status?: string; dht_nodes?: number };
    return { connectionStatus: body.connection_status ?? "unknown", dhtNodes: body.dht_nodes ?? 0 };
  } catch (err) {
    console.error("[qbittorrent] network read failed:", err);
    return null;
  }
}

/**
 * Torrents that are trying to download and getting nowhere.
 *
 * "Stalled" is qBittorrent's own word for a torrent with no usable peers.
 * A torrent that is downloading but pulling nothing counts too: with no
 * inbound port, a low-seed swarm gives you whichever seeds happen to accept
 * your outbound connection, which can be none of them.
 *
 * Completed torrents that are merely seeding to nobody are not a problem and
 * are excluded -- that is the normal resting state of a finished download.
 */
export function stalledDownloads(torrents: TorrentHealth[]): TorrentHealth[] {
  return torrents.filter(
    (t) =>
      t.progress < 1 &&
      (t.state === "stalledDL" || (t.state === "downloading" && t.dlSpeed === 0))
  );
}
