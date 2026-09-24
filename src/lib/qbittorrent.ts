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
    });
    return res.ok;
  } catch (err) {
    console.error("[qbittorrent] deleteTorrents failed:", err);
    return false;
  }
}

/** One torrent, reduced to what a health check needs. */
export type TorrentHealth = {
  name: string;
  state: string;
  progress: number;
  connectedSeeds: number;
  swarmSeeds: number;
  dlSpeed: number;
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
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      name?: string;
      state?: string;
      progress?: number;
      num_seeds?: number;
      num_complete?: number;
      dlspeed?: number;
    }[];
    return body.map((t) => ({
      name: t.name ?? "(unnamed)",
      state: t.state ?? "unknown",
      progress: t.progress ?? 0,
      connectedSeeds: t.num_seeds ?? 0,
      swarmSeeds: t.num_complete ?? 0,
      dlSpeed: t.dlspeed ?? 0,
    }));
  } catch (err) {
    console.error("[qbittorrent] torrent health read failed:", err);
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
