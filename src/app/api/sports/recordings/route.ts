import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { getRecordings, isSportarrConfigured } from "@/lib/sportarr";

/**
 * The Recordings tab: what Sportarr is downloading and what it has. Polled
 * while something is downloading, so the queue read behind it is shared and
 * short-lived (see getSportarrQueue).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!(await getValidSessionUserId(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSportarrConfigured()) {
    return NextResponse.json({ configured: false, downloading: [], ready: [] });
  }
  try {
    const { downloading, ready } = await getRecordings();
    return NextResponse.json({ configured: true, downloading, ready });
  } catch (err) {
    console.error("[sports/recordings] failed:", err);
    return NextResponse.json({ error: "Sportarr isn't responding" }, { status: 502 });
  }
}
