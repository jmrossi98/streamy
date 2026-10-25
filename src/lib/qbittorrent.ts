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
import { cached } from "./ttlCache";
import { progressKey, type ClientProgress } from "./liveProgressRules";
import type { TorrentTransfer } from "./torrentStatusRules";
import { forgetShared, sharedRead } from "./sharedRead";

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

/**
 * The session cookie, kept for a while rather than fetched per call. Every
 * read here used to log in first: the downloads panel polls every five
 * seconds, the healer and the seeding guard poll too, and each was a login
 * round trip to the home box before the real request. qBittorrent's default
 * session lasts an hour; a stale one is dropped on the first rejection (see
 * forgetSession) and the next call logs in again.
 */
const SESSION_TTL_MS = 10 * 60_000;
let session: { cookie: string; at: number } | null = null;

async function login(): Promise<string | null> {
  if (session && Date.now() - session.at < SESSION_TTL_MS) return session.cookie;
  const cookie = await freshLogin();
  session = cookie ? { cookie, at: Date.now() } : null;
  return cookie;
}

function forgetSession(): void {
  session = null;
}

async function freshLogin(): Promise<string | null> {
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
  /** qBittorrent's estimate, seconds; 8640000 means it has none. */
  etaSeconds?: number | null;
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
    if (!res.ok) {
      // A 403 is a session qBittorrent no longer accepts (it restarted);
      // the next call logs in afresh instead of failing for the TTL.
      if (res.status === 403) forgetSession();
      return null;
    }
    const body = (await res.json()) as {
      hash?: string;
      name?: string;
      state?: string;
      progress?: number;
      num_seeds?: number;
      num_complete?: number;
      dlspeed?: number;
      eta?: number;
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
      etaSeconds: t.eta ?? null,
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
  /** Current upload and download, bytes per second. */
  upBps: number;
  dlBps: number;
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
    const body = (await res.json()) as { connection_status?: string; dht_nodes?: number; up_info_speed?: number; dl_info_speed?: number };
    return {
      connectionStatus: body.connection_status ?? "unknown",
      dhtNodes: body.dht_nodes ?? 0,
      upBps: body.up_info_speed ?? 0,
      dlBps: body.dl_info_speed ?? 0,
    };
  } catch (err) {
    console.error("[qbittorrent] network read failed:", err);
    return null;
  }
}

/**
 * The same reading, shared for a few seconds: the admin Streaming tab polls it
 * and the load sampler reads it once a minute.
 */
export function getTorrentTransferRates(): Promise<TorrentNetwork | null> {
  return cached("qbittorrent:transfer", 5_000, getTorrentNetwork);
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

/** Shorter than the panel's refresh, so each refresh sees new progress; shared across its renders. */
const PROGRESS_TTL_MS = 2_000;

/**
 * Percent complete for every torrent, by info hash -- the download id Radarr
 * and Sonarr carry for a torrent. Empty when the client is not configured or
 * unreadable (the *arr's own figure then stands, see liveProgressRules.ts).
 */
/** Every torrent, read once per tick for the panel's progress and status lines. */
function sharedTorrentHealth(): Promise<TorrentHealth[]> {
  return sharedRead("qbt:torrents:health", PROGRESS_TTL_MS, async () => (await getTorrentHealth()) ?? []);
}

export async function getTorrentProgress(): Promise<ClientProgress> {
  if (!isQbittorrentConfigured()) return new Map();
  try {
    const torrents = await sharedTorrentHealth();
    return new Map(torrents.map((t) => [progressKey(t.hash), t.progress * 100]));
  } catch (err) {
    console.error("[qbittorrent] could not read torrent progress:", err);
    return new Map();
  }
}

/**
 * Seeders, speed and time left for every torrent, by info hash, for the
 * status line under a torrent row (torrentStatusRules.ts). Empty when
 * qBittorrent is not configured or unreadable: the row then shows its
 * percentage alone, as before.
 */
export async function getTorrentTransfers(): Promise<Map<string, TorrentTransfer>> {
  if (!isQbittorrentConfigured()) return new Map();
  try {
    const torrents = await sharedTorrentHealth();
    return new Map(
      torrents.map((t) => [
        progressKey(t.hash),
        {
          progress: t.progress,
          dlSpeed: t.dlSpeed,
          etaSeconds: t.etaSeconds ?? null,
          connectedSeeds: t.connectedSeeds,
          swarmSeeds: t.swarmSeeds,
          state: t.state,
        },
      ])
    );
  } catch (err) {
    console.error("[qbittorrent] could not read torrent status:", err);
    return new Map();
  }
}

/** A season pack added to qBittorrent by hand and tagged with its show -- see manualPackRules.ts. */
export type ManualSeasonPack = {
  hash: string;
  name: string;
  /** The folder the torrent's files sit under, as Sonarr sees it (same /data mount). */
  savePath: string;
  /** 0..1. */
  progress: number;
  sizeBytes: number;
  dlSpeed: number;
  etaSeconds: number | null;
  connectedSeeds: number;
  swarmSeeds: number;
  state: string;
  /** Unix seconds. */
  addedOn: number | null;
  completedOn: number | null;
  seriesId: number;
  seasonNumber: number;
  /** Video files in the pack, each with its path relative to savePath and whether it is complete. */
  files: { name: string; done: boolean }[];
};

const MANUAL_PACKS_TTL_MS = 3_000;

/**
 * Every tagged torrent in the manual-import category, with its files.
 * Empty when qBittorrent is not configured; throws when it cannot be read,
 * so a caller can tell "no packs" from "could not ask".
 */
export function getManualSeasonPacks(): Promise<ManualSeasonPack[]> {
  if (!isQbittorrentConfigured()) return Promise.resolve([]);
  return sharedRead("qbittorrent:manual-packs", MANUAL_PACKS_TTL_MS, readManualSeasonPacks, { serveStale: true });
}

async function readManualSeasonPacks(): Promise<ManualSeasonPack[]> {
  const { MANUAL_PACK_CATEGORY, isVideoFile, packTarget } = await import("./manualPackRules");
  const res = await qbit(`/api/v2/torrents/info?category=${encodeURIComponent(MANUAL_PACK_CATEGORY)}`);
  if (!res?.ok) {
    if (res?.status === 403) forgetSession();
    throw new Error(`qBittorrent torrents/info: ${res?.status ?? "unreachable"}`);
  }
  const torrents = (await res.json()) as {
    hash: string;
    name: string;
    save_path: string;
    progress: number;
    total_size?: number;
    size?: number;
    dlspeed: number;
    eta: number;
    num_seeds: number;
    num_complete: number;
    state: string;
    added_on: number;
    completion_on: number;
    tags: string;
  }[];
  const packs: ManualSeasonPack[] = [];
  for (const t of torrents) {
    const target = packTarget(t.tags);
    if (!target) continue;
    const filesRes = await qbit(`/api/v2/torrents/files?hash=${t.hash}`);
    const files = filesRes?.ok ? ((await filesRes.json()) as { name: string; progress: number; priority: number }[]) : [];
    packs.push({
      hash: t.hash.toLowerCase(),
      name: t.name,
      savePath: t.save_path.replace(/\/$/, ""),
      progress: t.progress,
      sizeBytes: t.total_size ?? t.size ?? 0,
      dlSpeed: t.dlspeed,
      etaSeconds: t.eta,
      connectedSeeds: t.num_seeds,
      swarmSeeds: t.num_complete,
      state: t.state,
      addedOn: t.added_on > 0 ? t.added_on : null,
      completedOn: t.completion_on > 0 ? t.completion_on : null,
      seriesId: target.seriesId,
      seasonNumber: target.seasonNumber,
      // Priority 0 is "do not download": a file left out of the pack on purpose.
      files: files.filter((f) => f.priority !== 0 && isVideoFile(f.name)).map((f) => ({ name: f.name, done: f.progress >= 1 })),
    });
  }
  return packs;
}

/** Removes a hand-added pack and its files -- the panel's Cancel on its row. */
export async function deleteManualPack(hash: string): Promise<boolean> {
  const { MANUAL_PACK_CATEGORY } = await import("./manualPackRules");
  const packs = await getManualSeasonPacks().catch(() => [] as ManualSeasonPack[]);
  // Only ever a torrent this module listed: the hash comes from a browser.
  if (!packs.some((p) => p.hash === hash.toLowerCase())) return false;
  const res = await qbit("/api/v2/torrents/delete", { hashes: hash.toLowerCase(), deleteFiles: "true" });
  if (res?.ok) forgetShared("qbittorrent:manual-packs");
  console.log(`[qbittorrent] deleted ${MANUAL_PACK_CATEGORY} pack ${hash}: ${res?.ok ? "ok" : res?.status ?? "unreachable"}`);
  return res?.ok === true;
}
