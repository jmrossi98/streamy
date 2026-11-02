/**
 * Getting a recorded title's transcode going again after its file changed.
 *
 * 2026-11-02, Potomac S11E4 in Safari: Sonarr replaced the 1080p file with a
 * 720p one a minute after import. Jellyfin re-indexed the episode under a new
 * item id 60 s later, but the viewer's stream kept failing for seven minutes
 * and only a page refresh fixed it, for two reasons:
 *
 *   - Jellyfin reuses a play session's transcode job, and the job's media
 *     source with it. Every request in that session -- including ones naming
 *     the new item -- was served from the deleted 1080p path, and Streamy's
 *     keepalive (playbackKeepalive.ts) plus Safari's own retries kept that
 *     job alive indefinitely. So a failed request now stops the session's
 *     job, and the next one starts from the item as it is now.
 *   - The playlist the player already holds names the old item as its
 *     mediaSourceId. A recorded title's only media source is the item itself
 *     (jellyfinHlsMasterUrl sends exactly that), so the proxy names the item
 *     it resolved, not whatever the playlist said.
 *
 * Live TV is left out of both: its media source is a stream Jellyfin opened,
 * not the item, and its sessions are managed separately.
 */

/** Rewrites a recorded title's mediaSourceId to the item being served. */
export function pinRecordedMediaSource(params: URLSearchParams, itemId: string): void {
  for (const key of ["mediaSourceId", "MediaSourceId"]) {
    if (params.has(key)) params.set(key, itemId);
  }
}

/**
 * Whether a failed request should stop the session's transcode job: a
 * recorded title's playlist or segment that Jellyfin itself failed (5xx).
 * Not the master, which always starts a fresh job anyway, and not a 4xx,
 * which is about the request rather than the job.
 */
export function shouldResetTranscode(opts: { live: boolean; jellyfinPath: string; status: number }): boolean {
  return !opts.live && opts.jellyfinPath !== "master.m3u8" && opts.status >= 500;
}
