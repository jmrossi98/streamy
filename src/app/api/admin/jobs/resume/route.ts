import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { startResumeJob } from "@/lib/resumeJobs";

export const runtime = "nodejs";

/**
 * Starts tailoring a resume to one listing and answers at once with the job;
 * the page polls GET ./[id] for its progress. A second tap while one is
 * running gets that one back.
 *
 * 2026-10-24: this used to do the whole tailoring inside the request (up to
 * ten minutes). A deploy restart killed Jake's Meta run at 42 s with a 499
 * and the button sat on "tailoring" forever.
 */
export async function POST(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const postingId = typeof body?.postingId === "string" ? body.postingId : "";
  if (!postingId) return NextResponse.json({ error: "postingId required" }, { status: 400 });

  const result = await startResumeJob(postingId, admin.name);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ jobId: result.job.id, job: result.job, existing: result.existing }, { status: 202 });
}
