import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/auditLog";
import { getSkillEngine, saveSkillEngine } from "@/lib/skillEngine";
import { isSkillRunnerConfigured, listEngines } from "@/lib/skillRunner";

/**
 * Which engine runs mediabox skills (Claude Code or OpenCode) and on what
 * model. Admin only, like everything that can spend money. GET also asks
 * the runner what each engine can do right now, so the panel can say
 * "ANTHROPIC_API_KEY is unset on mediabox" before a run fails on it.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function snapshot() {
  const choice = await getSkillEngine();
  if (!isSkillRunnerConfigured()) return { choice, engines: null, error: null };
  const r = await listEngines();
  return r.ok ? { choice, engines: r.data, error: null } : { choice, engines: null, error: r.error };
}

export async function GET() {
  if (!(await requireAdmin(await getSession()))) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  return NextResponse.json(await snapshot());
}

export async function PUT(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { engine?: unknown; model?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const saved = await saveSkillEngine(body);
  logAudit(admin.name, "skill.engine", `${saved.engine}${saved.engine === "opencode" ? ` ${saved.model}` : ""}`);
  return NextResponse.json(await snapshot());
}
