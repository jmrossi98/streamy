/**
 * Keeps a show page's Play/Resume button current after watching.
 *
 * Next episode moves the player to the episode's own page, and going back
 * reuses the show page the browser already had, rendered before the episode
 * was watched: Clone High still offered S1 E1 after E2 had been played
 * (2026-10-17). The player notes each show it saves progress for; the show
 * page, when it comes back or its player closes, takes the note and asks the
 * server for fresh resume data. A show nobody watched in between costs
 * nothing.
 *
 * sessionStorage, per tab: can be missing or throw, and then the page simply
 * keeps what it has.
 */
const key = (showId: string) => `streamy:watched-show:${showId}`;

export function markShowWatched(showId: string, store: Pick<Storage, "setItem"> | null = safeSession()): void {
  try {
    store?.setItem(key(showId), "1");
  } catch {
    // Private mode or blocked storage: no fresh-resume hint, nothing else lost.
  }
}

/** True once per watch: reading the note clears it. */
export function takeShowWatched(
  showId: string,
  store: Pick<Storage, "getItem" | "removeItem"> | null = safeSession()
): boolean {
  try {
    if (store?.getItem(key(showId)) == null) return false;
    store.removeItem(key(showId));
    return true;
  } catch {
    return false;
  }
}

function safeSession(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
