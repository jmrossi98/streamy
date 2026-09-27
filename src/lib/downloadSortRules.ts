/**
 * Ordering for the downloads panel.
 *
 * Pure and separate from the panel so the ordering can be tested without
 * rendering anything -- the same split the other *Rules modules use.
 */

/** Only the fields the ordering reads, so this does not depend on the row type. */
export type SortableDownload = {
  completed: boolean;
  addedAt?: string | null;
};

export type DownloadSort = "status" | "recent";

export const DOWNLOAD_SORTS: { id: DownloadSort; label: string }[] = [
  { id: "status", label: "Status" },
  { id: "recent", label: "Recently added" },
];

function addedTime(row: SortableDownload): number {
  if (!row.addedAt) return Number.NEGATIVE_INFINITY;
  const t = new Date(row.addedAt).getTime();
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/**
 * Orders rows for display, newest first when sorting by recently added.
 *
 * Anything still in flight stays pinned above the finished rows in both
 * orders. A download that is searching or transferring has no added date --
 * nothing has been added yet -- so sorting it by one would bury the row the
 * viewer is most likely watching underneath a library's worth of history.
 *
 * Within each group the incoming order is preserved, which for the active rows
 * is the caller's progress ordering. Sorting is stable in every engine this
 * runs on, so equal keys keep that order rather than shuffling between polls.
 */
export function sortDownloads<T extends SortableDownload>(rows: T[], sort: DownloadSort): T[] {
  if (sort !== "recent") return rows;
  return [...rows].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (!a.completed) return 0;
    return addedTime(b) - addedTime(a);
  });
}
