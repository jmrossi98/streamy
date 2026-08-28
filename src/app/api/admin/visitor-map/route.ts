import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { getVisitorMap } from "@/lib/visitorMapData";

/**
 * Visitor-map data, fetched on demand by the panel rather than built into the
 * admin page's initial render.
 *
 * The map is the heaviest thing the admin page does: it queries every visit and
 * login, memory-maps the ~60MB GeoLite2 database, and geolocates each distinct
 * IP. On a small instance, doing that eagerly on every admin load -- alongside a
 * dozen other probes in one Promise.all -- pushed the box past its memory and
 * hung the page. Deferring it to this endpoint keeps opening Admin cheap; the
 * map's cost is paid only when its panel actually asks for the data.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const map = await getVisitorMap();
  return NextResponse.json(map);
}
