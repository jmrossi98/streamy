/**
 * Pure rules for tailoring a resume as a background job (resumeJobs.ts).
 *
 * 2026-10-24: tailoring used to be one synchronous POST that could need ten
 * minutes (listing fetch, a researched draft, a review). Jake's run on Meta's
 * "Software Engineer (Technical Leadership)" died at 42 s with a 499 when a
 * deploy restarted the container, and the button's "busy" state lived only in
 * the page, so it looked stuck forever. Now the POST starts a job, the work
 * runs detached, and its state lives in the ResumeJob table where a reload or
 * a phone waking up can find it.
 */

export const RESUME_JOB_STEPS = ["Reading the listing", "Researching and drafting", "Reviewing", "Saving"] as const;
export type ResumeJobStep = (typeof RESUME_JOB_STEPS)[number];
export type ResumeJobStatus = "queued" | "running" | "succeeded" | "failed";

/** The runner touches heartbeatAt this often while it works. */
export const HEARTBEAT_MS = 20_000;
/**
 * A running job not heard from in this long has no process behind it: a
 * deploy restart or a crash killed it. Several missed heartbeats, so a slow
 * database write is not mistaken for a death.
 */
export const STALE_AFTER_MS = 2 * 60_000;
/**
 * The whole job, start to saved. Each model call gets what is left of it.
 *
 * 2026-10-24: first set at 8 minutes, but the self-test runs that evening
 * (Microsoft, Reddit, two Meta postings, Opus at high effort) took a 157-240 s
 * draft plus a 232-243 s review, plus ~8 s reading the vault and up to 14 s
 * rendering the listing: ~6.5-8.5 minutes, and one Meta run hit 8. Ten
 * leaves room for a slow day; past it the review is skipped and the draft kept.
 */
export const JOB_CAP_MS = 10 * 60_000;
/**
 * The hard stop fires this long after the cap: the review's own deadline ends
 * 15 s before the cap, and the draft it falls back to still has to be saved.
 */
export const HARD_STOP_GRACE_MS = 45_000;
/** A finished job stays on its listing's button this long after a reload. */
export const RECENT_FINISHED_MS = 24 * 3600_000;

export const INTERRUPTED_ERROR = "Interrupted by a server restart — tap Tailor again";
export const OVERRUN_ERROR = "Took longer than 10 minutes and was stopped — tap Tailor again";
export const LISTING_UNREAD_NOTE = "Couldn't read the listing page; tailored from web research";

export type ResumeJobRow = {
  id: string;
  postingId: string;
  status: string;
  step: string;
  error: string | null;
  note: string | null;
  versionId: string | null;
  startedAt: Date;
  updatedAt: Date;
  heartbeatAt: Date;
};

export type ResumeJobView = {
  id: string;
  postingId: string;
  status: ResumeJobStatus;
  step: string;
  error: string | null;
  note: string | null;
  versionId: string | null;
  startedAt: string;
  updatedAt: string;
};

export function isActive(status: string): boolean {
  return status === "queued" || status === "running";
}

/**
 * What a job really is right now. A row still saying "running" whose
 * heartbeat stopped is reported as failed: nothing will ever finish it, and
 * detecting that on read needs no cron.
 */
export function effectiveStatus(
  job: Pick<ResumeJobRow, "status" | "error" | "startedAt" | "heartbeatAt">,
  now: number
): { status: ResumeJobStatus; error: string | null } {
  const status = (["queued", "running", "succeeded", "failed"] as const).find((s) => s === job.status) ?? "failed";
  if (!isActive(status)) return { status, error: job.error };
  if (now - job.heartbeatAt.getTime() > STALE_AFTER_MS) return { status: "failed", error: INTERRUPTED_ERROR };
  // A live process past the cap plus a margin: the cap is enforced in the
  // runner, so this only catches a model call that ignored its timeout.
  if (now - job.startedAt.getTime() > JOB_CAP_MS + STALE_AFTER_MS) return { status: "failed", error: OVERRUN_ERROR };
  return { status, error: null };
}

export function toView(job: ResumeJobRow, now: number): ResumeJobView {
  const { status, error } = effectiveStatus(job, now);
  return {
    id: job.id,
    postingId: job.postingId,
    status,
    step: job.step,
    error,
    note: job.note,
    versionId: job.versionId,
    startedAt: job.startedAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

/**
 * Steps only move forward. A late write from an earlier step (or a write
 * after the job finished) must not drag the visible state backwards.
 */
export function canAdvance(current: { status: string; step: string }, next: ResumeJobStep): boolean {
  if (!isActive(current.status)) return false;
  const from = RESUME_JOB_STEPS.indexOf(current.step as ResumeJobStep);
  return RESUME_JOB_STEPS.indexOf(next) > from;
}

/** Milliseconds a model call may take: what is left of the cap, at most `max`. */
export function budgetFor(startedAt: number, now: number, max: number, reserveMs = 15_000): number {
  return Math.max(0, Math.min(max, startedAt + JOB_CAP_MS - reserveMs - now));
}

// ------------------------------------------------------------ listing text

/** Below this many characters of real text, a fetched page is a JS shell. */
export const MIN_LISTING_CHARS = 500;

/**
 * Career sites mediabox's /render will open (mediabox-infra skill-runner.py
 * RENDER_SITES; keep the two in step). The runner checks again; this list
 * just saves a round trip for a host it would refuse. A host also matches its
 * subdomains; Google only under its careers path.
 */
export const RENDER_SITES: { host: string; pathPrefix: string }[] = [
  { host: "metacareers.com", pathPrefix: "/" },
  { host: "jobs.apple.com", pathPrefix: "/" },
  { host: "www.google.com", pathPrefix: "/about/careers/" },
  { host: "careers.google.com", pathPrefix: "/" },
  { host: "bloomberg.avature.net", pathPrefix: "/" },
  { host: "deel.com", pathPrefix: "/" },
];

export function isRenderable(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  return RENDER_SITES.some(
    (s) => (host === s.host || host.endsWith(`.${s.host}`)) && (u.pathname || "/").startsWith(s.pathPrefix)
  );
}

/** Letters and digits: navigation chrome and whitespace don't count as listing text. */
export function realTextLength(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

/** Whether the plain fetch's text is enough, or the page needs a browser. */
export function needsRender(fetched: string, url: string): boolean {
  return realTextLength(fetched) < MIN_LISTING_CHARS && isRenderable(url);
}

/** The better of two readings: the fetch unless it was a shell and the render read more. */
export function pickListingText(fetched: string, rendered: string | null): { text: string; source: "fetch" | "render" | "none" } {
  const f = realTextLength(fetched);
  const r = rendered ? realTextLength(rendered) : 0;
  if (f >= MIN_LISTING_CHARS || (f > 0 && f >= r)) return { text: fetched, source: "fetch" };
  if (rendered && r > 0) return { text: rendered, source: "render" };
  return { text: "", source: "none" };
}

export function resumeLog(step: string, ms: number, extra: Record<string, string | number> = {}): string {
  const tail = Object.entries(extra)
    .map(([k, v]) => ` ${k}=${typeof v === "string" && /\s/.test(v) ? JSON.stringify(v) : v}`)
    .join("");
  return `[resume] step=${step} ms=${Math.round(ms)}${tail}`;
}
