/**
 * Jellyfin API client (server-side only). Set JELLYFIN_URL/JELLYFIN_API_KEY
 * in env to enable. Streamy streams from Jellyfin (which already scans
 * Radarr/Sonarr's output folders) rather than staging a copy in S3 --
 * titles become playable as soon as Jellyfin scans them in, no upload step.
 *
 * Playback is proxied through Streamy's own origin (/api/stream/*) rather
 * than pointing the browser straight at JELLYFIN_URL, because that URL is a
 * Tailscale-only address on plain HTTP: a viewer's browser can't route to it,
 * and an HTTPS page can't load HTTP media anyway (mixed content). Proxying
 * also keeps JELLYFIN_API_KEY server-side instead of embedding it in a URL
 * handed to the client.
 */

const JELLYFIN_URL = process.env.JELLYFIN_URL?.replace(/\/$/, "");
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY;
// Streamy talks to Jellyfin as one shared service account (JELLYFIN_API_KEY),
// not per-viewer -- there's no Jellyfin login tied to any individual Streamy
// profile. Progress sync (below) needs a concrete Jellyfin user to read/write
// UserData against, so it's addressed explicitly rather than guessed at (the
// account the household's Roku app(s) actually sign into -- confirmed live,
// this box only has one Jellyfin user at all). Unset means sync is simply
// skipped, same fail-closed posture as every other optional integration here.
const JELLYFIN_USER_ID = process.env.JELLYFIN_USER_ID;

export function isJellyfinConfigured(): boolean {
  return !!(JELLYFIN_URL && JELLYFIN_API_KEY);
}

async function jellyfinFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${JELLYFIN_URL}${path}`, {
    ...init,
    headers: { "X-Emby-Token": JELLYFIN_API_KEY!, ...(init?.headers ?? {}) },
    // Library contents change as downloads land; never serve a stale "not
    // available yet" answer from Next's fetch cache.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Jellyfin API error: ${res.status}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export type JellyfinItem = {
  Id: string;
  ProviderIds?: Record<string, string>;
  LocationType?: string;
  IndexNumber?: number;
};

/**
 * Jellyfin's `AnyProviderIdEquals` filter is silently ignored on this server
 * version -- it returns the whole library regardless of the id passed, which
 * made every title resolve to whichever movie happened to be present. So we
 * pull ProviderIds and match here instead. Personal-library sized, so listing
 * is cheap.
 */
export function matchesTmdbId(item: JellyfinItem, tmdbId: string): boolean {
  const ids = item.ProviderIds ?? {};
  const value = ids.Tmdb ?? ids.tmdb ?? ids.TMDB;
  return value === tmdbId;
}

/** A real file on disk -- not a metadata-only stub Jellyfin created for a folder with no media yet. */
export function isPlayable(item: JellyfinItem): boolean {
  return item.LocationType === "FileSystem";
}

// Radarr/Sonarr are supposed to poke Jellyfin to rescan on import, but that
// notification doesn't always land -- a finished movie then sits on disk,
// invisible to Jellyfin, and the title shows "Downloaded" with no way to
// play it. Asking Jellyfin to rescan when we come up empty closes that gap
// on its own. Rate-limited because scans are not free and every viewer polls.
const SCAN_COOLDOWN_MS = 60 * 1000;
let lastScanRequestedAt = 0;

// Exported so the Radarr/Sonarr webhooks can call this the moment a
// download actually completes, rather than only reactively the next time
// someone happens to load a page and findJellyfinMovieItemId/
// findJellyfinEpisodeItemId comes up empty. Radarr/Sonarr are *supposed* to
// notify Jellyfin themselves on import, but when that notification doesn't
// land, waiting on a viewer to visit the page (and eat the 60s cooldown
// below every time) is what let a fully-downloaded title sit unplayable for
// a long stretch -- reported live as "Downloaded -- tap to refresh" doing
// nothing, repeatedly, including after a real full page reload.
export function requestJellyfinLibraryScan(): void {
  if (!isJellyfinConfigured()) return;
  if (Date.now() - lastScanRequestedAt < SCAN_COOLDOWN_MS) return;
  lastScanRequestedAt = Date.now();
  fetch(`${JELLYFIN_URL}/Library/Refresh`, {
    method: "POST",
    headers: { "X-Emby-Token": JELLYFIN_API_KEY! },
    cache: "no-store",
  }).catch((err) => console.error("[jellyfin] library refresh failed:", err));
}

/** Jellyfin item id for a movie, by TMDB id. Null until it's actually scanned in with a real file. */
export async function findJellyfinMovieItemId(tmdbId: string): Promise<string | null> {
  if (!isJellyfinConfigured()) return null;
  try {
    const result = await jellyfinFetch<{ Items: JellyfinItem[] }>(
      `/Items?IncludeItemTypes=Movie&Recursive=true&fields=ProviderIds`
    );
    const item = result.Items.find((i) => matchesTmdbId(i, tmdbId) && isPlayable(i));
    if (!item) requestJellyfinLibraryScan();
    return item?.Id ?? null;
  } catch (err) {
    console.error(`[jellyfin] findJellyfinMovieItemId failed for tmdbId ${tmdbId}:`, err);
    return null;
  }
}

async function findJellyfinSeriesId(showTmdbId: string): Promise<string | null> {
  const result = await jellyfinFetch<{ Items: JellyfinItem[] }>(
    `/Items?IncludeItemTypes=Series&Recursive=true&fields=ProviderIds`
  );
  return result.Items.find((i) => matchesTmdbId(i, showTmdbId))?.Id ?? null;
}

/** Jellyfin item id for one episode. Null if the show or that specific episode isn't scanned in yet. */
export async function findJellyfinEpisodeItemId(
  showTmdbId: string,
  seasonNumber: number,
  episodeNumber: number
): Promise<string | null> {
  if (!isJellyfinConfigured()) return null;
  try {
    const seriesId = await findJellyfinSeriesId(showTmdbId);
    if (!seriesId) return null;

    const episodes = await jellyfinFetch<{ Items: JellyfinItem[] }>(
      `/Shows/${seriesId}/Episodes?seasonNumber=${seasonNumber}&fields=ProviderIds`
    );
    const episode = episodes.Items.find((e) => e.IndexNumber === episodeNumber && isPlayable(e));
    if (!episode) requestJellyfinLibraryScan();
    return episode?.Id ?? null;
  } catch (err) {
    console.error(
      `[jellyfin] findJellyfinEpisodeItemId failed for show ${showTmdbId} S${seasonNumber}E${episodeNumber}:`,
      err
    );
    return null;
  }
}

/** Whether a show has at least one real episode file scanned in -- gates Play vs. Download. */
export async function isJellyfinShowAvailable(showTmdbId: string): Promise<boolean> {
  if (!isJellyfinConfigured()) return false;
  try {
    const seriesId = await findJellyfinSeriesId(showTmdbId);
    if (!seriesId) {
      requestJellyfinLibraryScan();
      return false;
    }
    const episodes = await jellyfinFetch<{ Items: JellyfinItem[] }>(
      `/Shows/${seriesId}/Episodes?fields=ProviderIds`
    );
    const available = episodes.Items.some(isPlayable);
    if (!available) requestJellyfinLibraryScan();
    return available;
  } catch (err) {
    console.error(`[jellyfin] isJellyfinShowAvailable failed for tmdbId ${showTmdbId}:`, err);
    return false;
  }
}

/**
 * Upstream Jellyfin URL for an item's raw file. Server-side only -- this
 * carries the API key, so it must never be handed to the browser; the
 * /api/stream/* proxy routes fetch it and pipe the bytes back instead.
 */
export function jellyfinUpstreamStreamUrl(itemId: string): string {
  return `${JELLYFIN_URL}/Videos/${itemId}/stream?static=true&api_key=${JELLYFIN_API_KEY}`;
}

/**
 * Transcoded, browser-safe stream for content the browser can't direct-play
 * (HEVC/x265, 10-bit, some containers -- most 4K downloads).
 *
 * Asks Jellyfin to transcode to H.264/AAC in an MP4, downscaled to 1080p and
 * bitrate-capped. The downscale is deliberate: full 4K over a home uplink to a
 * remote browser would buffer regardless, and 1080p H.264 is well within the
 * 1050 Ti's NVENC. It stays progressive (not HLS) so it drops straight into the
 * same proxy and a plain <video> element.
 *
 * Bitrate/size are overridable so they can be tuned against the real Jellyfin:
 *   JELLYFIN_TRANSCODE_MAX_WIDTH   default 1920
 *   JELLYFIN_TRANSCODE_BITRATE     default 8000000 (8 Mbps)
 *
 * `startSeconds` restarts the transcode from that position instead of the
 * beginning. This matters because a progressive transcode can only be played
 * from where ffmpeg has already encoded to -- setting the <video> element's
 * currentTime ahead of that does nothing (the bytes for that position don't
 * exist yet), so a real seek has to ask Jellyfin to start a fresh encode at
 * the target instead. This is exactly what Jellyfin's own web client does.
 *
 * `playSessionId` identifies one continuous playback session to Jellyfin (a
 * stable id the player generates once and reuses across every seek within the
 * same viewing). Without it -- or without explicitly killing the old encode
 * before starting a new one, see stopJellyfinTranscode below -- Jellyfin can
 * keep the *previous* ffmpeg job running and just keep serving it, ignoring a
 * later startTimeTicks entirely; that's what "seeking snaps back to wherever
 * I first switched to 1080p" was.
 */
export function jellyfinTranscodeStreamUrl(
  itemId: string,
  startSeconds?: number,
  playSessionId?: string
): string {
  const params = new URLSearchParams({
    static: "false",
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    maxWidth: process.env.JELLYFIN_TRANSCODE_MAX_WIDTH || "1920",
    videoBitRate: process.env.JELLYFIN_TRANSCODE_BITRATE || "8000000",
    audioBitRate: "192000",
    api_key: JELLYFIN_API_KEY ?? "",
  });
  // Jellyfin ticks are 100-nanosecond units.
  if (startSeconds && startSeconds > 0) {
    params.set("startTimeTicks", String(Math.round(startSeconds * 10_000_000)));
  }
  if (playSessionId) params.set("PlaySessionId", playSessionId);
  return `${JELLYFIN_URL}/Videos/${itemId}/stream.mp4?${params.toString()}`;
}

/**
 * Same rationale as jellyfinTranscodeStreamUrl, but asks Jellyfin for its HLS
 * output instead of one progressive MP4. Safari (iOS and desktop) won't
 * reliably start playback against a live, growing, non-seekable progressive
 * stream -- it wants either a fully-buffered file or an HLS manifest, and
 * only the transcode itself can supply the latter for content Safari can't
 * direct-play. Chrome/Firefox don't have this problem, so they stay on the
 * simpler mp4 endpoint (see jellyfinTranscodeStreamUrl) -- see hlsSupport.ts
 * for how the player decides which one to request.
 *
 * `container: ts` (not the newer fmp4) deliberately -- it's Jellyfin's own
 * default and the most broadly compatible segment format, including with
 * Safari's native HLS decoder.
 */
/**
 * Note there is no start-position parameter. Jellyfin's HLS output is always a
 * complete VOD playlist of the entire title, addressed by segment index --
 * verified directly against the server, where the playlist came back
 * byte-identical (891 segments, 2671s) with and without startTimeTicks. Passing
 * one changed nothing about where playback began, so seeking and resuming are
 * both done client-side by setting currentTime; see usePlayerEngine's videoSrc.
 */
export function jellyfinHlsMasterUrl(
  itemId: string,
  playSessionId?: string,
  mediaSourceId?: string
): string {
  const params = new URLSearchParams({
    // Required by this server version -- omitting it fails the whole request
    // with HTTP 400 "The mediaSourceId field is required" before ffmpeg ever
    // starts (confirmed directly against Jellyfin). itemId is the right
    // fallback for the common case (a local file with one version) -- same
    // fallback getJellyfinSubtitleTracks already uses for the same field.
    mediaSourceId: mediaSourceId || itemId,
    videoCodec: "h264",
    audioCodec: "aac",
    maxWidth: process.env.JELLYFIN_TRANSCODE_MAX_WIDTH || "1920",
    videoBitRate: process.env.JELLYFIN_TRANSCODE_BITRATE || "8000000",
    audioBitRate: "192000",
    segmentContainer: "ts",
    api_key: JELLYFIN_API_KEY ?? "",
  });
  if (playSessionId) params.set("PlaySessionId", playSessionId);
  return `${JELLYFIN_URL}/Videos/${itemId}/master.m3u8?${params.toString()}`;
}

/**
 * Raw Jellyfin URL for one HLS sub-resource -- a variant playlist or a media
 * segment -- referenced from the master playlist above. Only ever reached
 * through the hls catch-all proxy route, which rewrites the master/variant
 * playlists so the browser's own requests for these come back through us
 * instead of going straight to Jellyfin (see proxyJellyfinHlsResource).
 */
export function jellyfinHlsResourceUrl(itemId: string, path: string, query: URLSearchParams): string {
  query.set("api_key", JELLYFIN_API_KEY ?? "");
  return `${JELLYFIN_URL}/Videos/${itemId}/${path}?${query.toString()}`;
}

export type JellyfinSubtitleTrack = {
  index: number;
  label: string;
  language: string | null;
};

/**
 * Subtitle tracks Jellyfin already knows about for one item (embedded in the
 * file or sitting alongside it as an external .srt/.vtt -- Jellyfin scans
 * both the same way). Returns null if the item has no subtitle streams at
 * all, so the player can skip rendering a subtitle control entirely rather
 * than showing an empty menu.
 */
export async function getJellyfinSubtitleTracks(
  itemId: string
): Promise<{ mediaSourceId: string; tracks: JellyfinSubtitleTrack[] } | null> {
  if (!isJellyfinConfigured()) return null;
  try {
    // Not /Items/{id} -- that single-item route (UserLibraryController.GetItem)
    // throws "Guid can't be empty" on this server version when called without a
    // userId, which we don't have (Streamy authenticates as the service API
    // key, not a specific Jellyfin user). The list route below is the same
    // query shape every other lookup in this file already uses successfully.
    const result = await jellyfinFetch<{
      Items: {
        MediaSources?: { Id: string }[];
        MediaStreams?: {
          Type: string;
          Index: number;
          DisplayTitle?: string;
          Language?: string;
          IsExternal?: boolean;
          Codec?: string;
        }[];
      }[];
    }>(`/Items?Ids=${itemId}&Fields=MediaStreams,MediaSources`);
    const item = result.Items[0];
    if (!item) return null;
    const mediaSourceId = item.MediaSources?.[0]?.Id ?? itemId;
    const tracks = (item.MediaStreams ?? [])
      .filter((s) => s.Type === "Subtitle")
      .map((s) => ({
        index: s.Index,
        label: s.DisplayTitle || s.Language || `Track ${s.Index}`,
        language: s.Language ?? null,
      }));
    if (tracks.length === 0) return null;
    return { mediaSourceId, tracks };
  } catch (err) {
    console.error(`[jellyfin] getJellyfinSubtitleTracks failed for item ${itemId}:`, err);
    return null;
  }
}

/** Jellyfin transcodes any subtitle format to WebVTT on request -- a plain <track> element can use this directly. */
export function jellyfinSubtitleStreamUrl(itemId: string, mediaSourceId: string, index: number): string {
  return `${JELLYFIN_URL}/Videos/${itemId}/${mediaSourceId}/Subtitles/${index}/Stream.vtt?api_key=${JELLYFIN_API_KEY}`;
}

// Tracks that direct play silently fails on rather than erroring: the
// browser plays what it can decode and just drops or blanks the rest, so
// there's no error event to react to -- confirmed live, twice, on real
// titles:
//  - The Wire S1E1 (HEVC 8-bit / AC3): picture flickering from a marginal
//    hardware decode path, no audio whatsoever.
//  - The Studio S1E1 (HEVC 10-bit / AAC): audio played completely normally,
//    picture was solid black -- the opposite failure, same root codec.
// None of this is guesswork about what browsers support -- Chrome
// specifically never ships AC3/DTS/TrueHD decode at all (licensing, not a
// bug), and HEVC support is inconsistent enough across browsers/GPUs/OSes
// (frequently no license for it on Windows at all) that "plays, but
// something's silently wrong" is the realistic outcome, not a clean error.
const AUDIO_CODECS_NEEDING_TRANSCODE = new Set(["ac3", "eac3", "dts", "truehd"]);
const VIDEO_CODECS_NEEDING_TRANSCODE = new Set(["hevc", "h265"]);

/**
 * Whether this item's audio or video track uses a codec direct play can't
 * reliably deliver -- see AUDIO_CODECS_NEEDING_TRANSCODE and
 * VIDEO_CODECS_NEEDING_TRANSCODE. Used to skip straight to the transcode
 * instead of attempting (and silently failing at) direct play first.
 */
export async function needsForcedTranscode(itemId: string): Promise<boolean> {
  if (!isJellyfinConfigured()) return false;
  try {
    const result = await jellyfinFetch<{
      Items: { MediaStreams?: { Type: string; Codec?: string }[] }[];
    }>(`/Items?Ids=${itemId}&Fields=MediaStreams`);
    const streams = result.Items[0]?.MediaStreams ?? [];
    const audioCodec = streams.find((s) => s.Type === "Audio")?.Codec?.toLowerCase();
    const videoCodec = streams.find((s) => s.Type === "Video")?.Codec?.toLowerCase();
    return (
      (!!audioCodec && AUDIO_CODECS_NEEDING_TRANSCODE.has(audioCodec)) ||
      (!!videoCodec && VIDEO_CODECS_NEEDING_TRANSCODE.has(videoCodec))
    );
  } catch (err) {
    console.error(`[jellyfin] needsForcedTranscode failed for item ${itemId}:`, err);
    return false;
  }
}

/**
 * Kills the ffmpeg job behind one transcode session. Call this before asking
 * for a new position in the same playback (see jellyfinTranscodeStreamUrl) --
 * without it, Jellyfin can leave the old encode running and just keep serving
 * that instead of honouring the new startTimeTicks. Best-effort: a seek
 * should still proceed even if this fails (nothing was playing from the old
 * job anymore either way once the browser moves on).
 */
export async function stopJellyfinTranscode(playSessionId: string): Promise<void> {
  if (!isJellyfinConfigured() || !playSessionId) return;
  try {
    await fetch(
      `${JELLYFIN_URL}/Videos/ActiveEncodings?deviceId=streamy&playSessionId=${encodeURIComponent(playSessionId)}`,
      { method: "DELETE", headers: { "X-Emby-Token": JELLYFIN_API_KEY! } }
    );
  } catch (err) {
    console.error(`[jellyfin] stopJellyfinTranscode failed for session ${playSessionId}:`, err);
  }
}

// Jellyfin stores position as 100ns "ticks" -- its own long-standing unit,
// shared with .NET's TimeSpan. 10,000,000 ticks per second.
const TICKS_PER_SECOND = 10_000_000;

/**
 * Reads how far the shared Jellyfin account (JELLYFIN_USER_ID -- e.g. the
 * household's Roku app) has gotten into a title, so a Streamy web session
 * can resume from there instead of restarting something already watched
 * further on the Roku app. Null whenever there's nothing to report: sync
 * unconfigured, never played, or the lookup itself fails -- callers just
 * fall back to Streamy's own stored progress in every one of those cases.
 */
export async function getJellyfinPlaybackPositionSeconds(itemId: string): Promise<number | null> {
  if (!isJellyfinConfigured() || !JELLYFIN_USER_ID) return null;
  try {
    const data = await jellyfinFetch<{ PlaybackPositionTicks?: number; Played?: boolean }>(
      `/UserItems/${itemId}/UserData?userId=${JELLYFIN_USER_ID}`
    );
    // A fully-played item's position ticks are reset to 0 once Played flips
    // true -- reporting that as "resume at 0" would be worse than not
    // syncing at all (it would restart something already finished).
    if (data.Played || !data.PlaybackPositionTicks) return null;
    return Math.floor(data.PlaybackPositionTicks / TICKS_PER_SECOND);
  } catch (err) {
    console.error(`[jellyfin] getJellyfinPlaybackPositionSeconds failed for item ${itemId}:`, err);
    return null;
  }
}

/**
 * Writes Streamy's own saved progress back to the shared Jellyfin account,
 * so a later Roku session picks up where a Streamy web session left off --
 * the other half of the sync getJellyfinPlaybackPositionSeconds reads.
 * Fire-and-forget from callers (saveProgress already is): a failure here
 * shouldn't affect Streamy's own, already-saved progress.
 */
export async function setJellyfinPlaybackPositionSeconds(itemId: string, seconds: number): Promise<void> {
  if (!isJellyfinConfigured() || !JELLYFIN_USER_ID || seconds < 0) return;
  try {
    await jellyfinFetch(`/UserItems/${itemId}/UserData?userId=${JELLYFIN_USER_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ PlaybackPositionTicks: Math.floor(seconds * TICKS_PER_SECOND) }),
    });
  } catch (err) {
    console.error(`[jellyfin] setJellyfinPlaybackPositionSeconds failed for item ${itemId}:`, err);
  }
}
