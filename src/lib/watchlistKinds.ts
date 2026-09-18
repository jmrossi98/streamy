/**
 * The one place that knows how each kind of saveable thing reaches its API.
 *
 * My List is five separate features that behave like one. Each had its own
 * button component, and the five had quietly drifted apart: three waited for
 * the server round trip before showing anything (the "I tapped it and nothing
 * happened" complaint that FlashWatchlistButton was explicitly rewritten to
 * fix, in a comment the other four never got), two called router.refresh() so
 * the server-rendered shelf above followed along and three did not, two checked
 * for a stale session and three did not, and the labels disagreed -- "In My
 * List" against "Remove from My List" for the identical state.
 *
 * Collapsing them to one component needs exactly this much per-kind knowledge:
 * where to POST, and what to call the id. Everything else -- optimistic flip,
 * revert on failure, refresh, stale-session handling, the label -- is the same
 * for all five and now only exists once.
 */

export type WatchlistKind = "movie" | "show" | "game" | "flash" | "channel";

type KindSpec = {
  /** Collection endpoint: POST to add, DELETE with `idParam` to remove. */
  endpoint: string;
  /** Query-string parameter naming the item on DELETE. */
  idParam: string;
  /** Body field naming the item on POST. */
  idField: string;
};

export const WATCHLIST_KINDS: Record<WatchlistKind, KindSpec> = {
  // Movies and shows share one endpoint and are told apart by which field is
  // set -- the shape the existing /api/watchlist route already expects.
  movie: { endpoint: "/api/watchlist", idParam: "movieId", idField: "movieId" },
  show: { endpoint: "/api/watchlist", idParam: "showId", idField: "showId" },
  game: { endpoint: "/api/games/watchlist", idParam: "gameKey", idField: "gameKey" },
  flash: { endpoint: "/api/games/flash-watchlist", idParam: "slug", idField: "slug" },
  channel: { endpoint: "/api/live/watchlist", idParam: "channelId", idField: "channelId" },
};

export function watchlistAddRequest(
  kind: WatchlistKind,
  itemId: string,
  /**
   * Fields some kinds store alongside the id. Games snapshot title/platform and
   * live channels snapshot name, because those catalogues are remote and a
   * saved row has to still render when the source is unreachable -- which for
   * the home server is a normal Tuesday.
   */
  extra?: Record<string, string>
): [string, RequestInit] {
  const spec = WATCHLIST_KINDS[kind];
  return [
    spec.endpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [spec.idField]: itemId, ...extra }),
    },
  ];
}

export function watchlistRemoveRequest(
  kind: WatchlistKind,
  itemId: string
): [string, RequestInit] {
  const spec = WATCHLIST_KINDS[kind];
  return [
    `${spec.endpoint}?${spec.idParam}=${encodeURIComponent(itemId)}`,
    { method: "DELETE" },
  ];
}
