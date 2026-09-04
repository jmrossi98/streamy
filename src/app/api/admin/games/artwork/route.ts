import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getArtworkCandidates,
  isArtworkKind,
  isSgdbConfigured,
  searchSgdbGames,
} from "@/lib/steamgriddb";

/**
 * The artwork picker's backend: resolve a ROM to a SteamGridDB game, list
 * candidate images of one kind, and save the chosen one as an override.
 *
 * Saved picks are what the Deck's steam_sync.py reads (via
 * /api/games/artwork-overrides) and applies in preference to its own
 * automatic top-scoring choice.
 */
export const dynamic = "force-dynamic";

/**
 * GET ?mode=games&q=<title>          -> SteamGridDB game matches for a title
 * GET ?mode=art&gameId=<id>&kind=<k> -> candidate images of one kind
 */
export async function GET(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (!isSgdbConfigured()) {
    return NextResponse.json(
      { error: "SteamGridDB is not configured (set SGDB_API_KEY)" },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");

  if (mode === "games") {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q) return NextResponse.json({ error: "q required" }, { status: 400 });
    return NextResponse.json({ games: await searchSgdbGames(q) });
  }

  if (mode === "art") {
    const gameId = Number(url.searchParams.get("gameId"));
    const kind = url.searchParams.get("kind");
    if (!Number.isFinite(gameId) || gameId <= 0) {
      return NextResponse.json({ error: "gameId required" }, { status: 400 });
    }
    if (!isArtworkKind(kind)) {
      return NextResponse.json({ error: "kind must be grid|hero|logo|icon" }, { status: 400 });
    }
    return NextResponse.json({ candidates: await getArtworkCandidates(gameId, kind) });
  }

  return NextResponse.json({ error: "mode must be games|art" }, { status: 400 });
}

/**
 * Saves (or clears) one artwork override.
 *
 * `imageUrl: null` deletes the override rather than storing an empty one, so
 * clearing a bad pick genuinely hands the game back to steam_sync.py's own
 * automatic choice instead of pinning it to nothing.
 */
export async function POST(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const system = typeof body.system === "string" ? body.system.trim() : "";
  const romStem = typeof body.romStem === "string" ? body.romStem.trim() : "";
  const kind = body.kind;
  if (!system || !romStem) {
    return NextResponse.json({ error: "system and romStem required" }, { status: 400 });
  }
  if (!isArtworkKind(kind)) {
    return NextResponse.json({ error: "kind must be grid|hero|logo|icon" }, { status: 400 });
  }

  const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : null;

  if (!imageUrl) {
    await prisma.gameArtwork.deleteMany({ where: { system, romStem, kind } });
    return NextResponse.json({ ok: true, cleared: true });
  }

  // Only ever store a SteamGridDB CDN URL. This value is handed to the Deck's
  // steam_sync.py, which downloads it unattended -- so an arbitrary
  // attacker-supplied URL here would become a server-side fetch on the Deck.
  // Admin-only already, but the allowlist costs nothing and keeps that from
  // being the only thing standing in the way.
  let host: string;
  try {
    host = new URL(imageUrl).hostname;
  } catch {
    return NextResponse.json({ error: "imageUrl must be a valid URL" }, { status: 400 });
  }
  if (host !== "cdn2.steamgriddb.com" && !host.endsWith(".steamgriddb.com")) {
    return NextResponse.json(
      { error: "imageUrl must be a steamgriddb.com asset" },
      { status: 400 }
    );
  }

  const sgdbGameId = typeof body.sgdbGameId === "number" ? body.sgdbGameId : null;
  const title = typeof body.title === "string" ? body.title : null;

  await prisma.gameArtwork.upsert({
    where: { system_romStem_kind: { system, romStem, kind } },
    create: { system, romStem, kind, imageUrl, sgdbGameId, title },
    update: { imageUrl, sgdbGameId, title },
  });

  return NextResponse.json({ ok: true });
}
