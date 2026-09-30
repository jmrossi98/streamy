import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/auditLog";
import { prepareApplication } from "@/lib/applyPacket";

export const runtime = "nodejs";
// May tailor a resume first (web research) and then draft answers.
export const maxDuration = 300;

/** Prepares an application packet for one listing. */
export async function POST(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const postingId = typeof body?.postingId === "string" ? body.postingId : "";
  if (!postingId) return NextResponse.json({ error: "postingId required" }, { status: 400 });
  const result = await prepareApplication(postingId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
  logAudit(admin.name, "apply.prepare", postingId);
  return NextResponse.json({ ok: true, id: result.id });
}
