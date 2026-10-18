/**
 * How the game page's player hears that the search for a game's own feed is
 * over (GameStreamFinder -> GameChannelPicker), so it can hold off tuning a
 * guess while the search runs. See GameChannelPicker's `holdForFeed`.
 */
export const GAME_FEED_SEARCH_EVENT = "streamy:game-feed-search";

export type GameFeedSearchOutcome = {
  fixtureId: string;
  outcome: "added" | "none";
  /** The channel added, by its Jellyfin id, once Jellyfin lists it. */
  channel?: { id: string; name: string };
  /** Added by the viewer from the list, not automatically: list it, don't switch to it. */
  manual?: boolean;
};

export function announceGameFeedSearch(detail: GameFeedSearchOutcome): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<GameFeedSearchOutcome>(GAME_FEED_SEARCH_EVENT, { detail }));
}
