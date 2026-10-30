import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { isDispatcharrConfigured, listIptvAccounts, liveConnections } from "@/lib/dispatcharr";
import { lineUse } from "@/lib/lineSteeringRules";

/**
 * Provider lines right now, for a game page that has been open a while: free
 * lines per provider and the channels already being watched (lineUse, the same
 * count the page uses at load). GameChannelPicker refreshes its load-time
 * snapshot with it before falling back or leaving a stalling feed, and every
 * ten minutes. Read-only: Dispatcharr's account list and proxy status, no
 * provider line touched.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!(await getValidSessionUserId(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDispatcharrConfigured()) return NextResponse.json({ freeLines: {}, watched: [] });
  const [accounts, connections] = await Promise.all([
    listIptvAccounts().catch(() => null),
    liveConnections().catch(() => null),
  ]);
  if (!accounts) return NextResponse.json({ error: "Dispatcharr did not answer" }, { status: 502 });
  const use = lineUse(accounts, connections);
  return NextResponse.json({ freeLines: use.freeLines, watched: [...use.watched] });
}
