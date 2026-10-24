import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/auditLog";
import { cancelRun } from "@/lib/skillRunner";

/** Stops a run. Logged like a start: stopping a half-done deploy is a change too. */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const { id } = await params;
  const r = await cancelRun(id);
  void logAudit(admin.name, r.ok ? "assistant.skill.cancel" : "assistant.skill.cancel.failed", id, r.ok ? "" : r.error);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
