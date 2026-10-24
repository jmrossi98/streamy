import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getResumeJob, startResumeJob } from "@/lib/resumeJobs";

/**
 * Operator trigger for resume tailoring, without an admin session.
 *
 * 2026-10-24: after the tailoring moved to a background job, nothing had
 * proven a generation still completes since the LLM routing change (#501),
 * and the only way to start one was the admin's button. This starts the same
 * job (lib/resumeJobs.ts) from the server, so a run can be checked end to end
 * with `docker logs` and the job status.
 *
 *   POST ?secret=…&postingId=…  -> 202 {jobId, job}
 *   GET  ?secret=…&jobId=…      -> {job, version: {id, model, chars} | null}
 *
 * Gated on JOB_LISTINGS_SECRET, like /api/cron/job-listings, and fails closed
 * when it is unset. Each POST spends model usage, so it is never on a timer.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request): NextResponse | null {
  const expected = process.env.JOB_LISTINGS_SECRET;
  if (!expected) return NextResponse.json({ error: "JOB_LISTINGS_SECRET is not set; refusing to run" }, { status: 503 });
  const url = new URL(request.url);
  const provided = url.searchParams.get("secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

export async function POST(request: Request) {
  const denied = authorized(request);
  if (denied) return denied;
  const postingId = new URL(request.url).searchParams.get("postingId") ?? "";
  if (!postingId) return NextResponse.json({ error: "postingId required" }, { status: 400 });
  const result = await startResumeJob(postingId, "selftest");
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ jobId: result.job.id, job: result.job, existing: result.existing }, { status: 202 });
}

export async function GET(request: Request) {
  const denied = authorized(request);
  if (denied) return denied;
  const jobId = new URL(request.url).searchParams.get("jobId") ?? "";
  const job = jobId ? await getResumeJob(jobId) : null;
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const version = job.versionId
    ? await prisma.resumeVersion.findUnique({ where: { id: job.versionId }, select: { id: true, model: true, markdown: true } })
    : null;
  return NextResponse.json({
    job,
    version: version ? { id: version.id, model: version.model, chars: version.markdown.length } : null,
  });
}
