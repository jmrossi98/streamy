/**
 * Resume tailoring as a background job. See resumeJobRules.ts for why.
 *
 * Lightsail runs one long-lived Node server, so a promise started here
 * outlives the request that started it (skillRunner.ts's watcher relies on the
 * same). What it does not outlive is a restart, which is why the state is in
 * the database with a heartbeat, and a dead job is spotted on read.
 */
import { logAudit } from "./auditLog";
import { prisma } from "./db";
import { generateTailoredResume } from "./resume";
import {
  canAdvance,
  effectiveStatus,
  HARD_STOP_GRACE_MS,
  HEARTBEAT_MS,
  isActive,
  JOB_CAP_MS,
  RECENT_FINISHED_MS,
  resumeLog,
  toView,
  type ResumeJobRow,
  type ResumeJobStep,
  type ResumeJobView,
} from "./resumeJobRules";

const ACTIVE = { in: ["queued", "running"] };

/** Postings with a start in flight in this process: two quick taps make one job. */
const starting = new Map<string, Promise<StartResult>>();

export type StartResult = { ok: true; job: ResumeJobView; existing: boolean } | { ok: false; status: number; error: string };

/** Starts a tailoring job for a posting, or returns the one already running. */
export function startResumeJob(postingId: string, requestedBy: string): Promise<StartResult> {
  const pending = starting.get(postingId);
  if (pending) return pending;
  const p = start(postingId, requestedBy).finally(() => starting.delete(postingId));
  starting.set(postingId, p);
  return p;
}

async function start(postingId: string, requestedBy: string): Promise<StartResult> {
  const now = Date.now();
  const latest = await prisma.resumeJob.findFirst({ where: { postingId, status: ACTIVE }, orderBy: { startedAt: "desc" } });
  if (latest) {
    const eff = effectiveStatus(latest, now);
    if (isActive(eff.status)) return { ok: true, job: toView(latest, now), existing: true };
    // Dead (a restart killed it): write down what it was, then start fresh.
    await markFailed(latest.id, eff.error ?? "Stopped");
  }
  const posting = await prisma.jobPosting.findUnique({ where: { id: postingId }, select: { id: true } });
  if (!posting) return { ok: false, status: 404, error: "That listing no longer exists." };

  const job = await prisma.resumeJob.create({ data: { postingId, requestedBy, status: "queued" } });
  void logAudit(requestedBy, "resume.generate.start", postingId, `job ${job.id}`);
  void run(job.id, postingId, job.startedAt.getTime(), requestedBy);
  return { ok: true, job: toView(job, Date.now()), existing: false };
}

async function markFailed(id: string, error: string): Promise<void> {
  await prisma.resumeJob.updateMany({ where: { id, status: ACTIVE }, data: { status: "failed", error } }).catch(() => undefined);
}

async function run(id: string, postingId: string, startedAt: number, requestedBy: string): Promise<void> {
  let step: { status: string; step: string } = { status: "running", step: "" };
  await prisma.resumeJob
    .updateMany({ where: { id, status: ACTIVE }, data: { status: "running", heartbeatAt: new Date() } })
    .catch(() => undefined);

  // The heartbeat is how a reader tells "slow" from "dead".
  const beat = setInterval(() => {
    void prisma.resumeJob
      .updateMany({ where: { id, status: ACTIVE }, data: { heartbeatAt: new Date() } })
      .catch(() => undefined);
  }, HEARTBEAT_MS);
  beat.unref?.();

  let capped = false;
  const cap = setTimeout(() => {
    capped = true;
    console.log(resumeLog("cap", Date.now() - startedAt, { job: id, at: step.step }));
    void markFailed(id, `Took longer than 10 minutes (stuck at "${step.step}") — tap Tailor again`);
  }, JOB_CAP_MS + HARD_STOP_GRACE_MS);
  cap.unref?.();

  const onStep = async (next: ResumeJobStep) => {
    if (capped || !canAdvance(step, next)) return;
    step = { status: "running", step: next };
    await prisma.resumeJob
      .updateMany({ where: { id, status: ACTIVE }, data: { step: next, heartbeatAt: new Date() } })
      .catch(() => undefined);
  };

  try {
    const result = await generateTailoredResume(postingId, { onStep, startedAt });
    if (capped) {
      // The cap already reported it failed; the version (if any) is still in
      // the Tailored resumes list.
      console.log(resumeLog("finished-after-cap", Date.now() - startedAt, { job: id, ok: String(result.ok) }));
      return;
    }
    if (result.ok) {
      await prisma.resumeJob.updateMany({
        where: { id, status: ACTIVE },
        data: { status: "succeeded", versionId: result.id, note: result.note, heartbeatAt: new Date() },
      });
      void logAudit(requestedBy, "resume.generate", postingId, `job ${id} -> version ${result.id}`);
    } else {
      await markFailed(id, result.error);
      console.log(resumeLog("failed", Date.now() - startedAt, { job: id, error: result.error.slice(0, 200) }));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(resumeLog("crashed", Date.now() - startedAt, { job: id, error: message.slice(0, 200) }));
    await markFailed(id, `Something went wrong: ${message}`);
  } finally {
    clearInterval(beat);
    clearTimeout(cap);
  }
}

export async function getResumeJob(id: string): Promise<ResumeJobView | null> {
  const job = await prisma.resumeJob.findUnique({ where: { id } });
  return job ? toView(job, Date.now()) : null;
}

/**
 * The newest job per posting started in the last day, for the listings to
 * pick up on load: a run in progress, or the resume a finished one made.
 */
export async function recentResumeJobs(): Promise<Record<string, ResumeJobView>> {
  const now = Date.now();
  const rows: ResumeJobRow[] = await prisma.resumeJob.findMany({
    where: { startedAt: { gte: new Date(now - RECENT_FINISHED_MS) } },
    orderBy: { startedAt: "asc" },
    take: 500,
  });
  const out: Record<string, ResumeJobView> = {};
  for (const row of rows) out[row.postingId] = toView(row, now);
  return out;
}
