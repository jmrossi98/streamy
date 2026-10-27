import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { getRun, replyToRun } from "@/lib/skillRunner";
import { isFinished, validateReply } from "@/lib/skillRunnerRules";

/**
 * Continues a finished run with the admin's reply (2026-10-27). The runner
 * starts a new run that resumes the parent's Claude Code session, so a run
 * that stopped partway can be told what to do next instead of being rerun
 * from scratch. Reached only from the Reply box on a run card -- like Run,
 * never from a model turn. `by` is the session's user, never the body's.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { message?: unknown } | null;
  const checked = validateReply(body?.message);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  // The parent's skill, args and engine, for the audit log and the email.
  const parent = await getRun(id);
  if (!parent.ok) return NextResponse.json({ error: parent.error }, { status: parent.status });
  if (!isFinished(parent.data.status)) {
    return NextResponse.json({ error: "That run is still going. Reply once it has finished." }, { status: 409 });
  }

  const r = await replyToRun(parent.data, checked.message, admin.name || "admin");
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(
    {
      id: r.data.id,
      status: r.data.status,
      position: r.data.position,
      continues: parent.data.id,
      skill: parent.data.skill,
    },
    { status: 202 }
  );
}
