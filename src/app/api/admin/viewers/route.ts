import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { getViewerActivity } from "@/lib/viewerActivity";

/** The admin Viewers panel's data, polled while the panel is open. */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  return NextResponse.json(await getViewerActivity());
}
