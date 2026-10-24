import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scrapeConfig, SCRAPED_PROVIDER } from "@/lib/jobBoardRules";

/**
 * Which career sites mediabox's scraper should scrape (scripts/job-scrape.py
 * in mediabox-infra), from each Custom row's Poll switch in Boards watched.
 *
 * Added 2026-10-24 so Poll on a scraped company actually stops the scrape
 * rather than only hiding its results. Streamy holds the switch and the
 * scraper reads it, the same direction download-warden.sh already talks in,
 * so it uses that script's credential: DOWNLOAD_WARDEN_SECRET is the one
 * secret mediabox already holds for calling Streamy. Fails closed when unset.
 *
 * The scraper fails open (scrapes everything) if this is unreachable, and the
 * poll filters out disabled companies anyway, so an outage here never stops
 * the listings.
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const expected = process.env.DOWNLOAD_WARDEN_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "DOWNLOAD_WARDEN_SECRET is not set; refusing to run" }, { status: 503 });
  }
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.jobBoardSource.findMany({
    where: { provider: SCRAPED_PROVIDER },
    select: { provider: true, slug: true, enabled: true },
  });
  return NextResponse.json(scrapeConfig(rows));
}
