import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Artwork overrides for the Steam Deck's steam_sync.py to apply.
 *
 * Called by the Deck (via rom-auto-import.sh, every 20 min) as:
 *   https://<host>/api/games/artwork-overrides?secret=<MEDIA_WEBHOOK_SECRET>
 *
 * No session auth -- the Deck runs this from a systemd timer with no browser
 * session, exactly like Radarr/Sonarr's webhooks. Reuses MEDIA_WEBHOOK_SECRET
 * rather than inventing a second machine credential, and fails closed the
 * same way: unset secret means every request is rejected.
 *
 * Returns every override rather than paginating: this is one row per
 * hand-picked asset (four kinds per game at most, only for games someone
 * deliberately corrected), so the whole set is small by construction and the
 * Deck wants all of it anyway.
 */
export const dynamic = "force-dynamic";

function verifySecret(request: Request): boolean {
  const secret = process.env.MEDIA_WEBHOOK_SECRET;
  if (!secret) return false;
  return new URL(request.url).searchParams.get("secret") === secret;
}

export async function GET(request: Request) {
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.gameArtwork.findMany({
    select: { system: true, romStem: true, kind: true, imageUrl: true, updatedAt: true },
  });

  return NextResponse.json({
    overrides: rows.map((r) => ({
      system: r.system,
      rom_stem: r.romStem,
      kind: r.kind,
      image_url: r.imageUrl,
      updated_at: r.updatedAt.toISOString(),
    })),
  });
}
