/**
 * The Live TV tabs, and how the URL names them.
 *
 * Decision 2026-10-16 (Jake): /live was one long page -- search, sort,
 * category, Select mode, the Hidden panel, bulk hide/delete, My Stations, the
 * league rows, the full grid, the sports schedule and a 400-line stream
 * browser, with the management controls sitting *above* what anyone came to
 * watch. The fix mirrors YouTube TV: separate tabs for watching now, the guide,
 * sports and recordings, and management nowhere near the viewing screens
 * (it lives at /admin/live-tv now).
 *
 * The tab is carried in the URL (`/live?tab=guide`) rather than component
 * state so a link to a tab works, and so back/forward returns to the tab you
 * left. Pure so the parsing is testable without a router.
 */

export const LIVE_TABS = [
  { key: "now", label: "Now" },
  { key: "guide", label: "Guide" },
  { key: "sports", label: "Sports" },
  { key: "recordings", label: "Recordings" },
] as const;

export type LiveTab = (typeof LIVE_TABS)[number]["key"];

export const DEFAULT_LIVE_TAB: LiveTab = "now";

/**
 * The tab a `?tab=` value names. Anything unrecognised -- a typo, a tab that
 * was renamed, a bookmark from a future PR -- lands on the default rather than
 * a blank page: the URL was a request to open Live TV, and that request is
 * still honoured.
 */
export function parseLiveTab(raw: string | null | undefined): LiveTab {
  if (!raw) return DEFAULT_LIVE_TAB;
  const key = raw.trim().toLowerCase();
  return LIVE_TABS.some((t) => t.key === key) ? (key as LiveTab) : DEFAULT_LIVE_TAB;
}

/**
 * The URL for a tab. The default tab is the bare path: `/live` and
 * `/live?tab=now` are the same page, and the bare one is what every existing
 * link to Live TV already says.
 */
export function liveTabHref(tab: LiveTab): string {
  return tab === DEFAULT_LIVE_TAB ? "/live" : `/live?tab=${tab}`;
}
