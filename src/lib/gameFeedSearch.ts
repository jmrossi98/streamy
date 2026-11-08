/**
 * How the game page's player hears that the search for a game's own feed is
 * over (GameStreamFinder -> GameChannelPicker), so it can hold off tuning a
 * guess while the search runs. See GameChannelPicker's `holdForFeed`.
 */
export const GAME_FEED_SEARCH_EVENT = "streamy:game-feed-search";

export type GameFeedSearchOutcome = {
  fixtureId: string;
  /**
   * "checking": still going, with how far along; "adding": a feed passed and
   * is being made a channel (and warmed up -- see warmLiveChannel), which
   * takes a while; "added" / "none": over.
   */
  outcome: "added" | "none" | "checking" | "adding" | "pending";
  /** With "checking": streams checked so far, of the ones to check. */
  progress?: { checked: number; total: number };
  /**
   * With "adding": the stream's name, so the player can say what it found.
   * With "pending": the new channel's name -- added, but Jellyfin doesn't list
   * it yet, so it is listed as joining and "added" follows once it does.
   */
  name?: string;
  /** The channel added, by its Jellyfin id, once Jellyfin lists it. */
  channel?: { id: string; name: string };
  /** Added by the viewer from the list, not automatically: list it, don't switch to it. */
  manual?: boolean;
};

export function announceGameFeedSearch(detail: GameFeedSearchOutcome): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<GameFeedSearchOutcome>(GAME_FEED_SEARCH_EVENT, { detail }));
}

/**
 * How long to keep asking whether Jellyfin lists a just-added channel. A
 * channel reaches Jellyfin on a guide refresh, and an add while one is running
 * waits for it (up to 90 s, refreshGuide) and then runs another, which can
 * itself take two minutes (2026-11-07). One minute covered the usual case.
 */
export const LINEUP_WAIT_MS = 3 * 60_000;
const LINEUP_POLL_MS = 4_000;

/** Jellyfin's id for a just-added channel once it lists it, or null after `waitMs`. */
export async function awaitLineupChannel(name: string, waitMs = LINEUP_WAIT_MS, signal?: AbortSignal): Promise<string | null> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline && !signal?.aborted) {
    try {
      const res = await fetch(`/api/live/lineup-channel?name=${encodeURIComponent(name)}`, { cache: "no-store", signal });
      const body = res.ok ? ((await res.json()) as { jellyfinId?: string | null }) : null;
      if (body?.jellyfinId) return body.jellyfinId;
    } catch {
      // Ask again until the deadline.
    }
    await new Promise((r) => setTimeout(r, LINEUP_POLL_MS));
  }
  return null;
}

/**
 * The other direction (GameChannelPicker -> GameStreamFinder): look again for
 * the game's own feed. Sent every FEED_RESCAN_MS while a guess is playing
 * (liveFailoverRules shouldRescanForFeed); a feed it finds comes back as an
 * "added" outcome and takes over like any other (foundFeedTakesOver).
 */
export const GAME_FEED_RESCAN_EVENT = "streamy:game-feed-rescan";

export function requestGameFeedRescan(fixtureId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<{ fixtureId: string }>(GAME_FEED_RESCAN_EVENT, { detail: { fixtureId } }));
}
