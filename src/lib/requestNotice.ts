import type { BadReleaseReason } from "./downloadHealthRules";

/**
 * Extra context a title's download state carries beyond its status and
 * percent: what the download is really doing, and anything the system did on
 * the viewer's behalf. Without it a rejected release just looked like a
 * download that stalled, or a search that spun forever, with no hint why.
 */
export type RequestDetail = {
  /** The transfer is done and the file is being moved into the library. */
  importing: boolean;
  /** One human-readable line to show under the button, or null. */
  notice: string | null;
};

export const NO_DETAIL: RequestDetail = { importing: false, notice: null };

export type RejectionSummary = { count: number; reason: BadReleaseReason };

const REASON_TEXT: Record<BadReleaseReason, string> = {
  executable: "it contained an executable file, not a video",
};

function releases(count: number): string {
  return count === 1 ? "1 release" : `${count} releases`;
}

/**
 * The line explaining a bad release, by where the title is right now.
 *
 * - `replacing`: the bad release is still in the queue, about to be removed.
 * - "requested": already removed, a search for another is running.
 * - "noReleaseFound": removed and the search came back empty -- said outright,
 *   because a silent dead end reads as a broken button.
 * Any other state has nothing to add: a healthy download or a finished title
 * doesn't need a history of what was skipped on the way.
 */
export function describeRequestNotice(input: {
  status: string | null;
  replacing: BadReleaseReason | null;
  rejections: RejectionSummary | null;
}): string | null {
  const { status, replacing, rejections } = input;

  if (replacing) {
    return `Unsafe release found — ${REASON_TEXT[replacing]}. Removing it and searching for another…`;
  }
  if (!rejections || rejections.count === 0) return null;

  const what = `${releases(rejections.count)} rejected as unsafe (${REASON_TEXT[rejections.reason]})`;
  if (status === "requested") {
    return `${what}. Searching for another…`;
  }
  if (status === "noReleaseFound") {
    return `${what}, and no other release is available yet. It will keep looking; you can also search again.`;
  }
  return null;
}
