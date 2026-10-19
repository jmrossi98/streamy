/**
 * Which transcode sessions still get a keepalive ping, and which are let go.
 *
 * Jellyfin kills an HLS job 60 seconds after its last segment request unless
 * the client pings the play session. Safari's native player fetches a dozen
 * segments at once and then goes quiet for 60-70 seconds while it plays
 * them, so on 2026-10-19 every one of its refills found the job dead:
 * Jellyfin started a fresh ffmpeg at the playlist's position, which sits a
 * keyframe or so before where the previous files had got to, and the viewer
 * saw a few seconds play twice while the seek bar carried on. Seven restarts
 * in a 17-minute viewing of Potomac S9E4. Live TV had the same bug class
 * (#416) and pings on every request; a VOD session has to be pinged on a
 * timer, because the quiet gap is the whole problem.
 */

/** Ping this often. Half of Jellyfin's 60 s timeout, so one lost ping is fine. */
export const PING_EVERY_MS = 30_000;

/**
 * A session nobody has fetched from for this long is dropped. The player
 * stops its transcode explicitly on a seek or exit (/api/stream/stop), so
 * this is only for a tab that vanished without saying so; the cost of a
 * kept-alive job with no viewer is one ffmpeg process Jellyfin's throttle
 * has already paused, so there is no hurry. A viewer paused for longer
 * than this gets one restart on resume, which is what happens today on
 * every refill.
 */
export const FORGET_AFTER_MS = 20 * 60_000;

export type KeepalivePlan = { ping: string[]; drop: string[] };

/** Splits the sessions seen (id → last request time) into ones to ping now and ones to forget. */
export function keepalivePlan(lastSeen: ReadonlyMap<string, number>, now: number, forgetAfterMs = FORGET_AFTER_MS): KeepalivePlan {
  const ping: string[] = [];
  const drop: string[] = [];
  for (const [id, at] of lastSeen) {
    if (now - at > forgetAfterMs) drop.push(id);
    else ping.push(id);
  }
  return { ping, drop };
}

/** The play session an HLS request belongs to: ours on the master, Jellyfin's echo after that. */
export function playSessionOf(params: URLSearchParams): string | null {
  return params.get("session") || params.get("PlaySessionId") || params.get("playSessionId") || null;
}
