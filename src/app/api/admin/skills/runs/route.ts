import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { getSkillEngine } from "@/lib/skillEngine";
import { listSkills, startRun } from "@/lib/skillRunner";
import { isSkillName, validateSkillArgs } from "@/lib/skillRunnerRules";

/**
 * Starts a skill run on mediabox. Reached only from a Run tap -- on a card the
 * assistant proposed, or the admin's own "Run on mediabox" form -- never from
 * a model turn. See skillRunnerRules.ts for why that is the boundary.
 *
 * The skill and args are re-checked against the runner's live list here,
 * rather than trusting the card: the browser's request is data like any other.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  // Re-read from the database rather than trusting the JWT's isAdmin claim.
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { skill?: unknown; args?: unknown } | null;
  if (!body || !isSkillName(body.skill)) return NextResponse.json({ error: "Unknown skill." }, { status: 400 });

  const list = await listSkills();
  if (!list.ok) return NextResponse.json({ error: list.error }, { status: list.status });
  const skill = list.data.find((s) => s.name === body.skill);
  if (!skill) return NextResponse.json({ error: `mediabox has no skill called ${body.skill}.` }, { status: 400 });
  const checked = validateSkillArgs(skill, body.args);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  // The saved admin choice decides the engine; the card has no say in it.
  const choice = await getSkillEngine();
  const r = await startRun(skill, checked.args, admin.name || "admin", choice);
  if (!r.ok) {
    return NextResponse.json(
      { error: r.error, ...(r.busyRunId ? { busy: true, running: r.busyRunId } : {}) },
      { status: r.status }
    );
  }
  return NextResponse.json(
    {
      id: r.data.id,
      skill: skill.name,
      args: checked.args,
      kind: skill.kind,
      engine: choice.engine,
      model: choice.engine === "opencode" ? choice.model : null,
    },
    { status: 202 }
  );
}
