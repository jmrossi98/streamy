import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { getResumeJob } from "@/lib/resumeJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A tailoring job's progress (lib/resumeJobs.ts). The segment is named [id]
 * to match its siblings ./[id]/download and ./[id]/pdf, which take a
 * ResumeVersion id; this one takes a ResumeJob id.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin(await getSession()))) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const { id } = await params;
  const job = await getResumeJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ job }, { headers: { "Cache-Control": "no-store" } });
}
