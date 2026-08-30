/**
 * Whether this browser can play HLS (.m3u8) natively in a plain <video>
 * element. True only for Safari (iOS and desktop) -- Chrome/Firefox/Edge
 * need a JS HLS library we don't ship. Used to route a transcode through
 * Jellyfin's HLS output instead of the simpler progressive MP4 endpoint:
 * Safari won't reliably start playback against the latter (a live, growing,
 * non-seekable stream), which is what "playback works on desktop but not
 * mobile" turned out to be -- see jellyfinHlsMasterUrl.
 *
 * Deliberately NOT `video.canPlayType('application/vnd.apple.mpegurl')`.
 * That was the first attempt (checking for a non-empty result) and it broke
 * playback on every desktop browser, not just fixed mobile Safari: Chrome
 * answers "maybe" for this MIME type despite having no real ability to play
 * it -- a plain <video src="*.m3u8"> in Chrome just hangs forever
 * (readyState 0, networkState loading, no error ever fired). Tightening the
 * check to `=== "probably"` isn't safe either -- canPlayType's maybe/
 * probably distinction is documented as unreliable and inconsistent across
 * Safari versions, so that risks the opposite failure: misclassifying
 * Safari as unsupported and reintroducing the original bug this exists to
 * fix. UA/vendor sniffing for actual Safari (not just WebKit -- Chrome and
 * Firefox on iOS are WebKit too, but report as CriOS/FxiOS and a non-Apple
 * vendor) is the standard, reliable way production code makes this exact
 * decision.
 */
export function supportsNativeHls(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isAppleVendor = (navigator.vendor || "").includes("Apple");
  const isOtherBrowserOnWebKit = /Chrome|CriOS|FxiOS|Firefox|Edg|OPR|Android/i.test(ua);
  return isAppleVendor && /Safari/i.test(ua) && !isOtherBrowserOnWebKit;
}
