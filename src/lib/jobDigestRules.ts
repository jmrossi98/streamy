/**
 * When new job postings are emailed, and which ones. Pure; lib/jobPostings.ts
 * does the database and the sending.
 *
 * ## Cadence (added 2026-10-24)
 *
 * The boards are polled every 30 minutes by a GitHub Actions schedule
 * (.github/workflows/job-listings.yml, at :05 and :35). Until 2026-10-24 every
 * poll that found something sent an email, so a busy afternoon was a dozen
 * messages. The digest cadence decides how often the queued, un-notified
 * postings go out in one message. It does not change how often boards are
 * polled: postings still land in the panel within half an hour.
 *
 * Boards marked "Email immediately" skip the queue and go out on the poll that
 * finds them.
 */

export const DIGEST_CADENCES = ["off", "1h", "3h", "6h", "12h", "1d", "1w"] as const;
export type DigestCadence = (typeof DIGEST_CADENCES)[number];

export const DIGEST_CADENCE_LABELS: Record<DigestCadence, string> = {
  off: "Off",
  "1h": "Every hour",
  "3h": "Every 3 hours",
  "6h": "Every 6 hours",
  "12h": "Every 12 hours",
  "1d": "Every day",
  "1w": "Every week",
};

const HOUR = 3600_000;

export const DIGEST_CADENCE_MS: Record<Exclude<DigestCadence, "off">, number> = {
  "1h": HOUR,
  "3h": 3 * HOUR,
  "6h": 6 * HOUR,
  "12h": 12 * HOUR,
  "1d": 24 * HOUR,
  "1w": 7 * 24 * HOUR,
};

/**
 * Hourly is the default: the closest to the old every-poll behaviour without
 * being two emails an hour.
 */
export const DEFAULT_DIGEST_CADENCE: DigestCadence = "1h";

export function parseDigestCadence(raw: string | null | undefined): DigestCadence {
  return (DIGEST_CADENCES as readonly string[]).includes(String(raw)) ? (raw as DigestCadence) : DEFAULT_DIGEST_CADENCE;
}

/**
 * How early a digest may go out. The poll only runs every 30 minutes and
 * GitHub's schedule drifts by several minutes, so without slack an hourly
 * digest sent at 10:05:40 would find 11:05:10 "59 minutes later" and slip to
 * 11:35 -- every hour becoming every hour and a half.
 */
export const DIGEST_GRACE_MS = 15 * 60_000;

/**
 * Whether the poll running at `now` should send the digest.
 *
 * Fixed rhythm: the clock restarts whenever a digest is due, whether or not
 * anything was queued, so a daily digest arrives at about the same time each
 * day instead of whenever the first posting after a quiet spell turns up.
 */
export function isDigestDue(cadence: DigestCadence, lastDigestAt: Date | null, now: Date): boolean {
  if (cadence === "off") return false;
  if (!lastDigestAt) return true;
  return now.getTime() - lastDigestAt.getTime() >= DIGEST_CADENCE_MS[cadence] - DIGEST_GRACE_MS;
}

/** When the next digest is expected, for the panel. Null when off. */
export function nextDigestAt(cadence: DigestCadence, lastDigestAt: Date | null, now: Date): Date | null {
  if (cadence === "off") return null;
  if (!lastDigestAt) return now;
  const next = new Date(lastDigestAt.getTime() + DIGEST_CADENCE_MS[cadence]);
  return next < now ? now : next;
}

export type PendingPosting = { id: string; company: string; level: string };

export type BoardEmailFlags = {
  /** Include in the digest (the row's "Email" box). */
  notify: boolean;
  /** Send as soon as it is found (the row's "Email immediately" box). */
  notifyImmediately: boolean;
};

export type AnnouncementPlan<P> = {
  /** Email now, outside the digest. */
  immediate: P[];
  /** Email in this digest. */
  digest: P[];
  /** Stamp notified without emailing. */
  silent: P[];
  /** Leave queued for a later digest. */
  held: P[];
};

/**
 * Sorts every un-notified posting into what happens to it on this poll.
 *
 * A posting that will never be emailed under the current settings (its level
 * is not one alerts are sent for, its company has Email off, or the digest is
 * off) is stamped silently rather than left queued. Otherwise widening a
 * setting later would announce the whole backlog at once -- the rule the
 * per-board Email switch and the alert levels have followed since 2026-09-28.
 *
 * A posting whose company is not in `flags` (a board removed since it was
 * found) is treated as Email on, digest only: the old behaviour for postings
 * with no board row.
 */
export function planAnnouncements<P extends PendingPosting>(
  pending: P[],
  opts: {
    flags: Map<string, BoardEmailFlags>;
    levels: Set<string>;
    cadence: DigestCadence;
    digestDue: boolean;
  }
): AnnouncementPlan<P> {
  const plan: AnnouncementPlan<P> = { immediate: [], digest: [], silent: [], held: [] };
  for (const posting of pending) {
    const flags = opts.flags.get(posting.company) ?? { notify: true, notifyImmediately: false };
    if (!opts.levels.has(posting.level)) plan.silent.push(posting);
    else if (flags.notifyImmediately) plan.immediate.push(posting);
    else if (opts.cadence === "off" || !flags.notify) plan.silent.push(posting);
    else if (opts.digestDue) plan.digest.push(posting);
    else plan.held.push(posting);
  }
  return plan;
}

/** Announce at most this many in one message; the rest are in the panel. */
export const MAX_ANNOUNCED = 12;

export type AnnouncedPosting = { company: string; title: string; location: string; url: string };

/** The subject and body of one announcement email. */
export function announcementMessage(
  postings: AnnouncedPosting[],
  kind: "digest" | "immediate"
): { subject: string; body: string } {
  const lines = postings
    .slice(0, MAX_ANNOUNCED)
    .map((p) => `${p.company} - ${p.title}\n  ${p.location}\n  ${p.url}`);
  if (postings.length > MAX_ANNOUNCED) {
    lines.push(`…and ${postings.length - MAX_ANNOUNCED} more in the admin panel.`);
  }
  const companies = new Set(postings.map((p) => p.company));
  let subject: string;
  if (postings.length === 1) subject = `New role: ${postings[0].company} - ${postings[0].title}`;
  else if (kind === "immediate" && companies.size === 1) subject = `${postings.length} new roles at ${postings[0].company}`;
  else subject = `${postings.length} new roles`;
  return { subject, body: lines.join("\n\n") };
}
