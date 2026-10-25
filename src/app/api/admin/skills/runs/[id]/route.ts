import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { getRun, kindOf, notifyFinishedOnce, notifyStartedOnce } from "@/lib/skillRunner";

/**
 * One run's status and output, polled by the chat's run card every ~2 s while
 * it waits and goes. A poll that sees a queued run begin sends the "started"
 * email, and one that sees an action/code run end sends the result email,
 * each once -- the fallback for when the background watcher was lost to a
 * redeploy mid-run.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const { id } = await params;
  const r = await getRun(id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  notifyStartedOnce(r.data);
  notifyFinishedOnce(r.data, await kindOf(r.data.skill));
  return NextResponse.json({ run: r.data });
}
