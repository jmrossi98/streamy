/**
 * Whether this browser can play HLS (.m3u8) natively in a plain <video>
 * element. True only for Safari (iOS and desktop) -- Chrome/Firefox/Edge
 * return "" and need a JS HLS library we don't ship. Used to route a
 * transcode through Jellyfin's HLS output instead of the simpler progressive
 * MP4 endpoint: Safari won't reliably start playback against the latter (a
 * live, growing, non-seekable stream), which is what "playback works on
 * desktop but not mobile" turned out to be -- see jellyfinHlsMasterUrl.
 */
export function supportsNativeHls(): boolean {
  if (typeof document === "undefined") return false;
  const v = document.createElement("video");
  return v.canPlayType("application/vnd.apple.mpegurl") !== "";
}
