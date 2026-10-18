import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hourlyTrend, trendSummary, type TrendBucket, type TrendSummary } from "@/lib/stallTrendRules";
import { getStreamLoadHistory, type StreamLoadHistory } from "@/lib/streamLoadHistory";
import { cached } from "@/lib/ttlCache";

/**
 * The admin Streaming tab's history: the last day's load and stall trend, and
 * a month of daily peaks. Loaded when the tab opens and every few minutes
 * after, so the aggregation is cached for a minute rather than redone per
 * admin tab.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type StreamingHistory = StreamLoadHistory & {
  stalls: TrendBucket[];
  stallSummary: TrendSummary;
};

export async function GET() {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const now = Date.now();
  const [load, stalls] = await Promise.all([
    getStreamLoadHistory(now),
    cached("stream-load:stalls", 60_000, async () => {
      const events = await prisma.playbackEvent.findMany({
        where: { at: { gte: new Date(now - 24 * 60 * 60_000) } },
        select: { at: true, kind: true, ms: true },
      });
      return hourlyTrend(events.map((e) => ({ at: e.at.getTime(), kind: e.kind, ms: e.ms })), now);
    }),
  ]);
  const body: StreamingHistory = { ...load, stalls, stallSummary: trendSummary(stalls) };
  return NextResponse.json(body);
}
