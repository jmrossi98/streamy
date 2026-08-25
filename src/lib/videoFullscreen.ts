/**
 * Mobile fullscreen for <video>: hand the OS its own player rather than
 * running the Fullscreen API on a wrapper div, which doesn't match how iOS
 * behaves and leaves you with a small inline video plus our own chrome on top.
 *
 * - iOS Safari: HTMLVideoElement.webkitEnterFullscreen()
 * - Most Android: video.requestFullscreen() on the video element
 *
 * Timing is the whole game here. Both APIs require an active user-gesture
 * context, and that context is gone by the time a `play()` promise resolves --
 * so calling this from `.then(...)` fails silently and the video just stays
 * inline. It has to be called straight from the tap handler, before anything
 * is awaited.
 */
export const MOBILE_FULLSCREEN_BREAKPOINT = 768;

export function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < MOBILE_FULLSCREEN_BREAKPOINT;
}

/** Only goes fullscreen below {@link MOBILE_FULLSCREEN_BREAKPOINT}px width. */
export function tryMobileNativeVideoFullscreen(video: HTMLVideoElement): void {
  if (!isMobileViewport()) return;
  enterNativeVideoFullscreen(video);
}

export function enterNativeVideoFullscreen(video: HTMLVideoElement): boolean {
  const v = video as HTMLVideoElement & {
    webkitEnterFullscreen?: () => void;
    webkitRequestFullscreen?: () => void;
  };

  // iOS only exposes this one, and only on the video element itself.
  if (typeof v.webkitEnterFullscreen === "function") {
    try {
      v.webkitEnterFullscreen();
      return true;
    } catch {
      return false;
    }
  }

  try {
    if (typeof video.requestFullscreen === "function") {
      void video.requestFullscreen();
      return true;
    }
  } catch {
    /* fall through to the prefixed form */
  }

  if (typeof v.webkitRequestFullscreen === "function") {
    try {
      v.webkitRequestFullscreen();
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Runs `onExit` when the viewer leaves fullscreen.
 *
 * iOS fires `webkitendfullscreen` on the video element and never touches the
 * document-level Fullscreen API, so listening only for `fullscreenchange`
 * misses it entirely -- which is how you end up stranded on a bare inline
 * player after tapping Done. Returns a cleanup function.
 */
export function onFullscreenExit(video: HTMLVideoElement, onExit: () => void): () => void {
  const handleDocumentChange = () => {
    const active =
      document.fullscreenElement ??
      (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement;
    if (!active) onExit();
  };

  video.addEventListener("webkitendfullscreen", onExit);
  document.addEventListener("fullscreenchange", handleDocumentChange);
  document.addEventListener("webkitfullscreenchange", handleDocumentChange);

  return () => {
    video.removeEventListener("webkitendfullscreen", onExit);
    document.removeEventListener("fullscreenchange", handleDocumentChange);
    document.removeEventListener("webkitfullscreenchange", handleDocumentChange);
  };
}
