/**
 * Mobile / TV-style native fullscreen for <video>: use the OS player when possible
 * instead of the Fullscreen API on a wrapper div (which does not match iOS behavior).
 *
 * - iOS Safari: HTMLVideoElement.webkitEnterFullscreen()
 * - Most Android: video.requestFullscreen() on the video element
 */
export const MOBILE_FULLSCREEN_BREAKPOINT = 768;

/** Only runs native fullscreen below {@link MOBILE_FULLSCREEN_BREAKPOINT}px width. */
export function tryMobileNativeVideoFullscreen(video: HTMLVideoElement): void {
  if (typeof window === "undefined" || window.innerWidth >= MOBILE_FULLSCREEN_BREAKPOINT) return;
  enterNativeVideoFullscreen(video);
}

export function enterNativeVideoFullscreen(video: HTMLVideoElement): boolean {
  const v = video as HTMLVideoElement & {
    webkitEnterFullscreen?: () => void;
  };

  if (typeof v.webkitEnterFullscreen === "function") {
    try {
      v.webkitEnterFullscreen();
      return true;
    } catch {
      // Often requires a user gesture; caller may retry from a tap handler
      return false;
    }
  }

  try {
    if (typeof video.requestFullscreen === "function") {
      void video.requestFullscreen();
      return true;
    }
  } catch {
    /* fall through */
  }

  const legacy = video as HTMLVideoElement & { webkitRequestFullscreen?: () => void };
  if (typeof legacy.webkitRequestFullscreen === "function") {
    try {
      legacy.webkitRequestFullscreen();
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
