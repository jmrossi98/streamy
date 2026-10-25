import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { applyRunTurn } from "@/lib/chatSessions";
import { getRun } from "@/lib/skillRunner";
import { isRunId } from "@/lib/skillRunnerRules";

/**
 * Puts one skill run's turn into one saved chat: added when the run starts or
 * is followed, rewritten with the report when it ends. The browser sends only
 * the run id; the turn's text is built here from the runner's own record, and
 * only that turn changes -- never the rest of the transcript.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { runId?: unknown } | null;
  if (!body || typeof body.runId !== "string" || !isRunId(body.runId)) {
    return NextResponse.json({ error: "Not a run id." }, { status: 400 });
  }
  const run = await getRun(body.runId);
  if (!run.ok) return NextResponse.json({ error: run.error }, { status: run.status });
  const session = await applyRunTurn(admin.id, id, run.data);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ session });
}
