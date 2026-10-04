/**
 * Folding the downloads panel's TV rows into one entry per show. Pure.
 *
 * The panel lists TV per episode, which is the right grain for watching one
 * download and the wrong one for everything else: a show with three seasons
 * on disk is sixty rows, and removing it meant sixty clicks. Each show is
 * instead one collapsible entry -- seasons inside it, episodes inside those
 * -- with an action at every level. Movies stay as they are.
 */

export type GroupableRow = {
  mediaType: "movie" | "show";
  externalId: number;
  title: string;
  completed: boolean;
  progress: number | null;
  queued?: boolean;
  searching?: boolean;
  noRelease?: boolean;
  seriesTitle?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

export type SeasonGroup<T> = {
  /** null for rows not tied to a season: a whole-show search, an unmatched grab. */
  seasonNumber: number | null;
  rows: T[];
};

export type PanelItem<T> =
  | { kind: "row"; row: T }
  | { kind: "series"; externalId: number; title: string; seasons: SeasonGroup<T>[]; rows: T[] };

/** Numbered seasons in order, then Extras (season 0), then anything unplaced. */
function seasonRank(n: number | null): number {
  if (n == null) return Number.MAX_SAFE_INTEGER;
  return n === 0 ? Number.MAX_SAFE_INTEGER - 1 : n;
}

/**
 * One item per movie row and one per show, in the order the rows arrive: a
 * show sits where its first row would have, so the panel's sort still decides
 * what is on top. Inside a show, seasons and episodes are in viewing order.
 */
export function groupDownloads<T extends GroupableRow>(rows: T[]): PanelItem<T>[] {
  const items: PanelItem<T>[] = [];
  const shows = new Map<number, Extract<PanelItem<T>, { kind: "series" }>>();
  for (const row of rows) {
    if (row.mediaType !== "show") {
      items.push({ kind: "row", row });
      continue;
    }
    let group = shows.get(row.externalId);
    if (!group) {
      group = { kind: "series", externalId: row.externalId, title: row.seriesTitle || row.title, seasons: [], rows: [] };
      shows.set(row.externalId, group);
      items.push(group);
    }
    // The first row may have been one without a series title.
    if (row.seriesTitle) group.title = row.seriesTitle;
    group.rows.push(row);
  }
  for (const group of shows.values()) {
    const bySeason = new Map<number | null, T[]>();
    for (const row of group.rows) {
      const n = row.seasonNumber ?? null;
      bySeason.set(n, [...(bySeason.get(n) ?? []), row]);
    }
    group.seasons = [...bySeason.entries()]
      .sort(([a], [b]) => seasonRank(a) - seasonRank(b))
      .map(([seasonNumber, seasonRows]) => ({
        seasonNumber,
        rows: [...seasonRows].sort(
          (a, b) => (a.episodeNumber ?? Number.MAX_SAFE_INTEGER) - (b.episodeNumber ?? Number.MAX_SAFE_INTEGER)
        ),
      }));
  }
  return items;
}

export function seasonLabel(seasonNumber: number | null): string {
  if (seasonNumber == null) return "Other";
  return seasonNumber === 0 ? "Extras" : `Season ${seasonNumber}`;
}

/**
 * What the button on a show or season does, named for what is in it: nothing
 * finished is a Cancel, everything finished is a Delete, a mix is a Remove.
 * The action underneath is the same -- stop what is in flight, delete what is
 * on disk -- only the word changes, so it never promises less than it does.
 */
export function groupActionLabel(rows: Pick<GroupableRow, "completed">[]): "Cancel" | "Delete" | "Remove" {
  const done = rows.filter((r) => r.completed).length;
  if (done === 0) return "Cancel";
  return done === rows.length ? "Delete" : "Remove";
}

/** "12 episodes · 3 downloading · 2 queued · 7 downloaded", leaving out the zeroes. */
export function groupSummary(rows: GroupableRow[]): string {
  const downloaded = rows.filter((r) => r.completed).length;
  const notFound = rows.filter((r) => !r.completed && r.noRelease).length;
  const queued = rows.filter((r) => !r.completed && !r.noRelease && r.queued).length;
  const searching = rows.filter((r) => !r.completed && !r.noRelease && !r.queued && r.searching).length;
  const downloading = rows.length - downloaded - notFound - queued - searching;
  const parts = [`${rows.length} ${rows.length === 1 ? "episode" : "episodes"}`];
  if (downloading > 0) parts.push(`${downloading} downloading`);
  if (searching > 0) parts.push(`${searching} searching`);
  if (queued > 0) parts.push(`${queued} queued`);
  if (notFound > 0) parts.push(`${notFound} not found`);
  if (downloaded > 0) parts.push(`${downloaded} downloaded`);
  return parts.join(" · ");
}

/**
 * Average progress of what is actually transferring, or null when nothing
 * is: a collapsed show still has to show that something inside it is moving.
 */
export function groupProgress(rows: GroupableRow[]): number | null {
  const moving = rows.filter((r) => !r.completed && !r.queued && !r.searching && !r.noRelease && r.progress != null);
  if (moving.length === 0) return null;
  return Math.round(moving.reduce((sum, r) => sum + (r.progress ?? 0), 0) / moving.length);
}
