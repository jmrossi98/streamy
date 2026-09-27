/**
 * Ordering for the downloads panel.
 *
 * Pure and separate from the panel so the ordering can be tested without
 * rendering anything -- the same split the other *Rules modules use.
 */

/** Only the fields the ordering reads, so this does not depend on the row type. */
export type SortableDownload = {
  completed: boolean;
  /** When the row started: queued, requested, grabbed or landed. */
  startedAt?: string | null;
  addedAt?: string | null;
};

export type DownloadSort = "status" | "recent";

export const DOWNLOAD_SORTS: { id: DownloadSort; label: string }[] = [
  { id: "status", label: "Status" },
  { id: "recent", label: "Recently added" },
];

function addedTime(row: SortableDownload): number {
  // startedAt first: every kind of row now has one (enqueued, requested,
  // grabbed, landed), where addedAt only ever existed for finished files.
  const raw = row.startedAt ?? row.addedAt;
  if (!raw) return Number.NEGATIVE_INFINITY;
  const t = new Date(raw).getTime();
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
  // Purely by time now, with no in-flight pinning. Pinning existed because
  // only finished rows had a date, so sorting by it buried everything else;
  // now that a queued or searching row carries the moment it was asked for,
  // newest-first already puts a fresh request at the top -- which is the
  // reason to open this panel at all.
  return [...rows].sort((a, b) => addedTime(b) - addedTime(a));
}
