/**
 * What changes when an IPTV provider's login changes. Pure.
 *
 * Dispatcharr identifies a stream by its URL (stream_settings.m3u_hash_key =
 * "url"), and an Xtream Codes stream URL carries the login
 * (/live/<user>/<pass>/<id>.ts). So after a refresh under a new login every
 * stream is a new object, and every channel stays attached to the old copy,
 * which no longer plays. The guide (EPG) URL embeds the login too.
 *
 * The same rules run on mediabox every ten minutes (mediabox-infra
 * scripts/iptv-credentials-sync.py) as a safety net; these run the moment a
 * login is saved in the admin panel, so live TV does not wait for the cron.
 */

export type RelinkStream = {
  id: number;
  name: string;
  /** The provider's own id for the stream: stable across a login change on the same panel. */
  stream_id?: number | null;
  last_seen?: string | null;
  is_stale?: boolean;
  m3u_account?: number | null;
};

/**
 * A stream's name without the provider's category prefix ("US| ", "USA - "),
 * quality tag or superscript marks. The same rule as base_name in
 * mediabox-infra's iptv-credentials-sync.py.
 */
export function baseName(name: string): string {
  let n = (name ?? "").replace(/[ᴬ-ᶿ⁰-₟]+/g, " ").toUpperCase();
  n = n.replace(/^\s*[^|]{1,24}\|\s*|^\s*[A-Z0-9+ ]{1,10}\s-\s+/, "");
  n = n.replace(/\s+/g, " ").trim();
  const quality = /\s+(?:F?HD|HDTV|SD|4K|UHD|RAW)$/;
  while (quality.test(n)) n = n.replace(quality, "").trim();
  return n;
}

/**
 * The newest non-stale copy of the same stream, if there is a newer one.
 * Matched by provider stream id first, else by exact name (a provider that
 * moved to a new panel renumbers everything). An id match only counts when
 * the names agree too: trex's 2026-10 renewal moved it to a panel that reused
 * ids for other channels, and id-alone matching put "CBS CHIEFS KANSAS CITY"
 * on a Finnish Disney+ feed.
 */
export function newestReplacement(stream: RelinkStream, pool: RelinkStream[]): RelinkStream | null {
  const sid = stream.stream_id;
  const base = baseName(stream.name);
  const same = pool.filter(
    (s) =>
      s.id !== stream.id &&
      !s.is_stale &&
      ((sid != null && s.stream_id === sid && (s.name === stream.name || (!!base && baseName(s.name) === base))) ||
        s.name === stream.name)
  );
  same.sort((a, b) => {
    const byId = Number(sid != null && b.stream_id === sid) - Number(sid != null && a.stream_id === sid);
    return byId || (b.last_seen ?? "").localeCompare(a.last_seen ?? "");
  });
  const best = same[0];
  return best && (best.last_seen ?? "") > (stream.last_seen ?? "") ? best : null;
}

/** A channel's streams with each moved onto its newest copy; same order. */
export function relinkChannelStreams(
  streamIds: number[],
  byId: Map<number, RelinkStream>,
  poolByAccount: Map<number, RelinkStream[]>
): number[] {
  return streamIds.map((id) => {
    const s = byId.get(id);
    if (!s || s.m3u_account == null) return id;
    return newestReplacement(s, poolByAccount.get(s.m3u_account) ?? [])?.id ?? id;
  });
}

/** The guide URL with the account's current server and login, or null if it is not an Xtream xmltv.php URL. */
export function epgUrlFor(epgUrl: string | null | undefined, account: { serverUrl: string; username: string; password: string }): string | null {
  let u: URL;
  try {
    u = new URL(epgUrl ?? "");
  } catch {
    return null;
  }
  if (!u.pathname.endsWith("xmltv.php")) return null;
  try {
    const server = new URL(account.serverUrl);
    u.protocol = server.protocol;
    u.host = server.host;
  } catch {
    /* keep the guide's own host */
  }
  u.searchParams.set("username", account.username);
  u.searchParams.set("password", account.password);
  return u.toString();
}
