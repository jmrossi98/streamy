/**
 * Below this width, the player treats the viewport as mobile: hold at the
 * play button instead of autoplaying (autoplay isn't a user gesture, and
 * fullscreen -- via usePlayerChrome's toggleFullscreen -- can only be
 * requested from a live one), and fill the viewport via CSS the same way
 * desktop does rather than reaching for the native <video> fullscreen APIs,
 * which replace the whole element with the OS's own player and can't show
 * our own chrome (quality, subtitles, next-episode) at all.
 */
export const MOBILE_FULLSCREEN_BREAKPOINT = 768;

export function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < MOBILE_FULLSCREEN_BREAKPOINT;
}
