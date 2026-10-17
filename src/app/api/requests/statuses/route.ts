import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseStatusKeys, statusKey } from "@/lib/posterDownloadRules";

/**
 * Download status for many titles at once, for the admin's download button on
 * poster tiles. One query per page of tiles instead of one request per tile.
 * POST so a My List page's several hundred ids don't land in a URL.
 */
export async function POST(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const keys = parseStatusKeys(body?.keys);
  if (keys.length === 0) return NextResponse.json({ statuses: {} });

  const rows = await prisma.mediaRequest.findMany({
    where: { OR: keys.map(({ tmdbId, mediaType }) => ({ tmdbId, mediaType })) },
    select: { tmdbId: true, mediaType: true, status: true },
  });
  const statuses: Record<string, string> = {};
  for (const r of rows) statuses[statusKey(r.mediaType, r.tmdbId)] = r.status;
  return NextResponse.json({ statuses });
}
