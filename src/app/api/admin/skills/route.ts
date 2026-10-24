import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { isSkillRunnerConfigured, listSkills, NOT_CONFIGURED } from "@/lib/skillRunner";

/**
 * The skills mediabox's runner offers, for the chat's "Run on mediabox" menu
 * and the proposal cards. `?fresh=1` skips the five-minute cache, for the menu
 * being opened right after the runner was redeployed with a new skill.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  // 200, not 503: "not configured" is a state the menu renders, not a failure.
  if (!isSkillRunnerConfigured()) return NextResponse.json({ configured: false, skills: [], error: NOT_CONFIGURED });
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  const r = await listSkills(fresh);
  if (!r.ok) return NextResponse.json({ configured: true, skills: [], error: r.error });
  return NextResponse.json({ configured: true, skills: r.data });
}
