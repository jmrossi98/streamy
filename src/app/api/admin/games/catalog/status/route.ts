import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { getCatalogGame, isIgdbConfigured } from "@/lib/igdb";
import { gameStatuses } from "@/lib/gameGrabs";

/** Where a catalog game stands on each console it came out on (gameJobRules.ts). Admin only. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!isIgdbConfigured()) return NextResponse.json({ error: "The game catalog is not set up." }, { status: 503 });
  const igdbId = Number(new URL(request.url).searchParams.get("igdbId"));
  const game = await getCatalogGame(igdbId).catch(() => null);
  if (!game) return NextResponse.json({ error: "No such game in the catalog." }, { status: 404 });
  return NextResponse.json({ statuses: await gameStatuses(game.id, game.name, game.systems) }, { headers: { "Cache-Control": "no-store" } });
}
