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
  outcome: "added" | "none" | "checking" | "adding";
  /** With "checking": streams checked so far, of the ones to check. */
  progress?: { checked: number; total: number };
  /** With "adding": the stream's name, so the player can say what it found. */
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
