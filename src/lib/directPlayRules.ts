/**
 * Whether a browser can direct-play a file's *container*, as opposed to its
 * codecs (those are needsForcedTranscode's AUDIO/VIDEO_CODECS_NEEDING_TRANSCODE).
 *
 * Only Chromium (Chrome, Edge, Opera, Brave) demuxes Matroska. Safari, every
 * iOS browser (all WebKit) and Firefox do not -- and Safari does not say so:
 * on 2026-10-15 a Mac on Safari 26 opened an H.264/AAC .mkv (Real Housewives
 * of Salt Lake City S07E05), raised no error, and just downloaded the file --
 * 1.3 GB per attempt -- with nothing on screen. With no error event the
 * direct-play -> transcode fallback in usePlayerEngine never fired, so the
 * same viewer who had played HEVC titles the day before (forced straight to
 * the transcode by codec) could not play this one at all. For such a file the
 * transcode is a remux -- the video is copied, not re-encoded -- so going
 * there directly costs Jellyfin next to nothing.
 *
 * Pure: the User-Agent is read by the caller.
 */

/** Containers every browser this site supports direct-plays. */
const UNIVERSAL_CONTAINERS = new Set(["mp4", "m4v", "mov"]);
/** What Chromium adds on top. */
const CHROMIUM_CONTAINERS = new Set(["mkv", "matroska", "webm"]);

/** iPhone/iPad/iPod: every browser there is WebKit, whatever it calls itself. */
function isIos(ua: string): boolean {
  return /\b(iPhone|iPad|iPod)\b/.test(ua);
}

/** Desktop or Android Chromium. Not iOS "Chrome" (CriOS), which is WebKit. */
export function isChromium(ua: string): boolean {
  return !isIos(ua) && /\b(Chrome|Chromium|Edg|OPR)\//.test(ua);
}

/**
 * True when this browser should skip direct play of a file in this container
 * and go straight to the transcode. A missing User-Agent or container keeps
 * the old behaviour (try direct play) rather than guessing.
 *
 * `container` is Jellyfin's, which can be a comma list ("mov,mp4,m4a").
 */
export function containerBlocksDirectPlay(
  container: string | null | undefined,
  userAgent: string | null | undefined
): boolean {
  if (!container || !userAgent) return false;
  const names = container.toLowerCase().split(",").map((c) => c.trim()).filter(Boolean);
  if (names.length === 0) return false;
  const playable = (c: string) =>
    UNIVERSAL_CONTAINERS.has(c) || (isChromium(userAgent) && CHROMIUM_CONTAINERS.has(c));
  return !names.some(playable);
}
