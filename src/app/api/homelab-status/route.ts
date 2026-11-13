import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { homelabStatus } from "@/lib/homelabBreaker";

/**
 * Whether mediabox is reachable, as the server last saw it (homelabBreaker.ts),
 * for the site-wide banner to appear and clear without a reload. Signed-in
 * only: the state of the home network is nobody else's business.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(homelabStatus(), { headers: { "Cache-Control": "no-store" } });
}
