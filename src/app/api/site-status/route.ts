import { NextResponse } from "next/server";
import { getSiteSettings } from "@/lib/siteSettings";

/**
 * Whether the site is in maintenance, for the maintenance page to notice when
 * it is over (MaintenanceReturn). Public on purpose and says nothing else:
 * someone looking at the maintenance page already knows the answer.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const { maintenance } = await getSiteSettings();
  return NextResponse.json({ maintenance }, { headers: { "Cache-Control": "no-store" } });
}
