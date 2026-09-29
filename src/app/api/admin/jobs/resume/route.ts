import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/auditLog";
import { generateTailoredResume } from "@/lib/resume";

export const runtime = "nodejs";
// Web research plus a full resume from a frontier model: well over a minute.
export const maxDuration = 300;

/** Tailors a resume to one listing and returns the new version's id. */
export async function POST(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const postingId = typeof body?.postingId === "string" ? body.postingId : "";
  if (!postingId) return NextResponse.json({ error: "postingId required" }, { status: 400 });

  const result = await generateTailoredResume(postingId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
  logAudit(admin.name, "resume.generate", postingId);
  return NextResponse.json({ ok: true, id: result.id });
}
