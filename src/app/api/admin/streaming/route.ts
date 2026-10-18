import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { getStreamingNow } from "@/lib/streamingNow";

/** The admin Streaming tab's live panel, polled while it is open. */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  return NextResponse.json(await getStreamingNow());
}
