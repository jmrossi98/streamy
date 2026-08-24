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
