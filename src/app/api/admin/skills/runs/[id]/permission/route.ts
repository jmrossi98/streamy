import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/auditLog";
import { replyPermission } from "@/lib/skillRunner";
import { isPermissionResponse } from "@/lib/skillRunnerRules";

/**
 * The admin's answer to a question an OpenCode run asked: allow this
 * command once, allow it for the rest of the run, or reject it. Only a tap
 * on the run card reaches here -- the model proposing a run never gets to
 * approve its own commands.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { permissionID?: unknown; response?: unknown } | null;
  const permissionID = body?.permissionID;
  if (typeof permissionID !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(permissionID) || !isPermissionResponse(body?.response)) {
    return NextResponse.json({ error: "permissionID and response (once, always or reject) are required." }, { status: 400 });
  }
  const who = admin.name || "admin";
  const r = await replyPermission(id, permissionID, body.response, who);
  void logAudit(who, r.ok ? "assistant.skill.permission" : "assistant.skill.permission.failed", id, `${permissionID}: ${body.response}`);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
