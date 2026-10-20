import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { getExitNodeClients, isExitNodeClientsConfigured } from "@/lib/exitNodeClients";
import { buildView, type ExitNodeClientsView } from "@/lib/exitNodeClientsRules";

/**
 * The admin Streaming tab's exit-node clients panel, polled while it is open:
 * who is on each exit node, by which path, and a day of per-device
 * throughput. The derivation runs here so the browser gets series it can
 * draw rather than a day of raw counters to crunch on every poll.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type { ExitNodeClientsView };

export async function GET() {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const history = await getExitNodeClients();
  return NextResponse.json(buildView(history, Date.now(), isExitNodeClientsConfigured()));
}
