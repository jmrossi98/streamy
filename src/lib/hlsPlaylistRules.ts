/**
 * Live HLS playlists, trimmed to a sliding window before they reach the
 * viewer. Pure.
 *
 * Jellyfin's live playlist is EVENT-type: it only ever grows (one 1-second
 * segment per second) and never drops anything. hls.js re-fetches it about
 * once a second, and the proxy rewrote every line each time, so a viewer's
 * cost rose with how long they had been tuned: last week's access log had a
 * 102-minute session fetch its playlist 5,387 times, up to 419 KB each --
 * about 3 Mbps of playlist alone by the end, on top of the video, and 1.45 GB
 * of playlists in the week (measured 2026-10-18).
 *
 * Keeping the last LIVE_PLAYLIST_WINDOW_SEGMENTS makes it an ordinary live
 * playlist with a 10-minute window: MEDIA-SEQUENCE advances by what was
 * dropped (that is how a player tells a sliding list apart from a reset),
 * the EVENT type is removed (an EVENT list promises never to drop), and
 * DISCONTINUITY-SEQUENCE counts any discontinuities that fell out. A VOD
 * list (ENDLIST) is never touched.
 */

export const LIVE_PLAYLIST_WINDOW_SEGMENTS = 600;

const SEGMENT_TAGS = ["#EXTINF", "#EXT-X-BYTERANGE", "#EXT-X-PROGRAM-DATE-TIME", "#EXT-X-DISCONTINUITY", "#EXT-X-GAP", "#EXT-X-BITRATE"];

function isSegmentTag(line: string): boolean {
  // "#EXT-X-DISCONTINUITY" exactly: "#EXT-X-DISCONTINUITY-SEQUENCE" is a header.
  if (line.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE")) return false;
  return SEGMENT_TAGS.some((t) => line.startsWith(t));
}

function headerValue(lines: string[], tag: string): number {
  const line = lines.find((l) => l.startsWith(tag + ":"));
  const n = line ? Number.parseInt(line.slice(tag.length + 1), 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

function setHeader(lines: string[], tag: string, value: number): void {
  const i = lines.findIndex((l) => l.startsWith(tag + ":"));
  if (i !== -1) lines[i] = `${tag}:${value}`;
  else {
    // After TARGETDURATION if present, else right after #EXTM3U.
    const after = lines.findIndex((l) => l.startsWith("#EXT-X-TARGETDURATION"));
    lines.splice((after !== -1 ? after : 0) + 1, 0, `${tag}:${value}`);
  }
}

export function windowLivePlaylist(text: string, maxSegments = LIVE_PLAYLIST_WINDOW_SEGMENTS): string {
  const lines = text.split("\n");
  if (lines.some((l) => l.startsWith("#EXT-X-ENDLIST"))) return text;
  // Each segment entry is its tags followed by its URI line. The header is
  // everything before the first entry's tags.
  const uriIdx: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l && !l.startsWith("#")) uriIdx.push(i);
  }
  if (uriIdx.length === 0) return text; // a master playlist, or nothing yet
  let firstEntry = uriIdx[0];
  while (firstEntry > 0 && isSegmentTag(lines[firstEntry - 1].trim())) firstEntry--;
  const header = lines.slice(0, firstEntry).filter((l) => !l.startsWith("#EXT-X-PLAYLIST-TYPE:EVENT"));

  const drop = Math.max(0, uriIdx.length - maxSegments);
  if (drop === 0) return [...header, ...lines.slice(firstEntry)].join("\n");

  // The kept region starts right after the last dropped URI.
  const keepFrom = uriIdx[drop - 1] + 1;
  const dropped = lines.slice(firstEntry, keepFrom);
  const discontinuities = dropped.filter((l) => l.trim() === "#EXT-X-DISCONTINUITY").length;

  setHeader(header, "#EXT-X-MEDIA-SEQUENCE", headerValue(header, "#EXT-X-MEDIA-SEQUENCE") + drop);
  if (discontinuities > 0) {
    setHeader(header, "#EXT-X-DISCONTINUITY-SEQUENCE", headerValue(header, "#EXT-X-DISCONTINUITY-SEQUENCE") + discontinuities);
  }
  return [...header, ...lines.slice(keepFrom)].join("\n");
}
