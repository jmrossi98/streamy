import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { getCatalogGame, isIgdbConfigured } from "@/lib/igdb";
import { requestGame } from "@/lib/gameGrabs";
import { logAudit } from "@/lib/auditLog";

/**
 * Downloads a catalog game for one console (gameGrabs.ts): usenet when a
 * release exists, gamarr's queue when not. Admin only. The game's name comes
 * from IGDB by id, never from the request.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!isIgdbConfigured()) return NextResponse.json({ error: "The game catalog is not set up." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { igdbId?: unknown; system?: unknown };
  const igdbId = Number(body.igdbId);
  const system = typeof body.system === "string" ? body.system : "";
  const game = await getCatalogGame(igdbId).catch(() => null);
  if (!game) return NextResponse.json({ error: "No such game in the catalog." }, { status: 404 });
  if (!game.systems.includes(system)) return NextResponse.json({ error: `${game.name} did not come out on that console.` }, { status: 400 });

  const result = await requestGame(game.id, game.name, system);
  logAudit(
    admin.name,
    result.ok ? "games.catalog.request" : "games.catalog.request.failed",
    `${game.name} (${system})`,
    result.ok ? (result.via === "usenet" ? `usenet: ${result.release}` : "gamarr queue") : result.error
  );
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
