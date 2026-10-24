/**
 * Pure rules for letting a deploy wait for long-running work (deployDrain.ts,
 * /api/cron/deploy-drain, .github/workflows/deploy.yml).
 *
 * 2026-10-24: deploys every 5-10 minutes killed a 7-minute resume job four
 * times (Jake's Roblox posting). #534's restart recovery re-runs a killed job
 * from the start, but each re-run is a full model run and the next deploy
 * killed that one too. Now a deploy asks the app whether it is busy, waits
 * (capped) until it isn't, and sets a "draining" flag meanwhile so new work
 * is held for the new container instead of starting into a restart.
 */

/**
 * How long a draining flag counts once set. The deploy clears it after the
 * swap and on giving up; this is the backstop for a deploy that dies between
 * the two (a cancelled run, an SSH drop), so a stuck flag can only hold new
 * resume jobs this long. Longer than the deploy's 12-minute wait plus the
 * swap, shorter than anyone would put up with a held job.
 */
export const DRAIN_TTL_MS = 20 * 60_000;
/** The deploy may ask for less, never for more. */
export const MAX_DRAIN_TTL_MS = 30 * 60_000;

/** Setting row holding the drain deadline (an ISO time). */
export const DRAIN_SETTING_KEY = "deploy_draining_until";

/**
 * The step a held resume job shows. The panel renders "<step>…", so this is
 * what Jake sees on the button while a deploy is draining.
 */
export const HELD_STEP = "Waiting for a site update to finish";

/**
 * Whether a stored drain deadline is still in force. Anything unreadable is
 * "not draining": a garbled row must never hold jobs.
 */
export function drainState(value: string | null | undefined, now: number): { draining: boolean; until: string | null } {
  if (!value) return { draining: false, until: null };
  const until = Date.parse(value);
  if (!Number.isFinite(until) || until <= now) return { draining: false, until: null };
  // A deadline further out than any deploy could ask for is a clock or write
  // bug; capping it keeps the TTL promise.
  const capped = Math.min(until, now + MAX_DRAIN_TTL_MS);
  return { draining: true, until: new Date(capped).toISOString() };
}

/** The deadline to store for a drain requested now, ttl clamped to (0, MAX]. */
export function drainDeadline(now: number, ttlMs?: number | null): Date {
  const ttl = typeof ttlMs === "number" && Number.isFinite(ttlMs) && ttlMs > 0 ? Math.min(ttlMs, MAX_DRAIN_TTL_MS) : DRAIN_TTL_MS;
  return new Date(now + ttl);
}

export type BusyJob = { kind: string; id: string; startedAt: string; eta: string | null };
export type BusyReport = { busy: boolean; jobs: BusyJob[] };

/**
 * A tailoring's usual length, for the eta only. 2026-10-24 self-tests: a
 * 157-240 s draft plus a 232-243 s review, ~6.5-8.5 minutes in all.
 */
export const RESUME_TYPICAL_MS = 8 * 60_000;

export type ResumeJobLike = {
  id: string;
  status: string;
  step: string;
  startedAt: Date;
  heartbeatAt: Date;
};

/** See busyReport: an Apple Notes sync older than this is not waited for. */
export const APPLE_NOTES_MAX_MS = 15 * 60_000;

export type AppleNotesLike = { running: boolean; startedAt: Date | null };

/**
 * What a deploy would interrupt right now.
 *
 * Counted:
 * - resume jobs queued/running with a heartbeat younger than staleAfterMs: a
 *   restart throws away minutes of model output. A held job (HELD_STEP) is
 *   not counted -- it is waiting for this very restart, and counting it would
 *   make every drain wait its full cap.
 * - an Apple Notes sync in progress: the request was already answered 200,
 *   so the notes it carries exist only in this process's memory.
 *
 * Deliberately not counted, because a restart costs them nothing real:
 * - the episode-search drain: a persisted queue built to resume after a
 *   restart (sonarr.ts), and the warden's next pass picks it up.
 * - the job-listings poll: idempotent, and the next cron tick repeats it.
 * - skill-run watchers: the run itself lives on mediabox; a restart loses
 *   only the finish-email watcher, and runs can last hours, which would pin
 *   every deploy to its cap.
 */
export function busyReport(
  input: { resumeJobs: ResumeJobLike[]; appleNotes: AppleNotesLike; staleAfterMs: number; capMs: number },
  now: number
): BusyReport {
  const jobs: BusyJob[] = [];
  for (const j of input.resumeJobs) {
    if (j.status !== "queued" && j.status !== "running") continue;
    if (j.step === HELD_STEP) continue;
    if (now - j.heartbeatAt.getTime() > input.staleAfterMs) continue;
    // Past the job's own hard cap nothing useful is left to wait for.
    if (now - j.startedAt.getTime() > input.capMs) continue;
    const started = j.startedAt.getTime();
    const eta = Math.max(now, Math.min(started + RESUME_TYPICAL_MS, started + input.capMs));
    jobs.push({ kind: "resume", id: j.id, startedAt: j.startedAt.toISOString(), eta: new Date(eta).toISOString() });
  }
  // A sync running longer than this is hung on WebDAV, not nearly done;
  // waiting on it would only pin the deploy to its cap.
  const notesStarted = input.appleNotes.startedAt?.getTime() ?? now;
  if (input.appleNotes.running && now - notesStarted < APPLE_NOTES_MAX_MS) {
    jobs.push({
      kind: "apple-notes-sync",
      id: "apple-notes",
      startedAt: (input.appleNotes.startedAt ?? new Date(now)).toISOString(),
      eta: null,
    });
  }
  return { busy: jobs.length > 0, jobs };
}
