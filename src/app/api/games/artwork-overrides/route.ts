import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Artwork and title overrides for the Steam Deck's / desktop's steam_sync
 * scripts to apply.
 *
 * Called by the Deck (via rom-auto-import.sh) and the desktop (via the
 * "Steam Shortcuts Sync" scheduled task) as:
 *   https://<host>/api/games/artwork-overrides?secret=<MEDIA_WEBHOOK_SECRET>
 *
 * No session auth -- both callers run unattended (a systemd timer / a
 * Windows scheduled task) with no browser session, exactly like
 * Radarr/Sonarr's webhooks. Reuses MEDIA_WEBHOOK_SECRET rather than
 * inventing a second machine credential, and fails closed the same way:
 * unset secret means every request is rejected.
 *
 * Returns every override rather than paginating: this is a handful of rows
 * per game someone deliberately corrected (four artwork kinds at most, plus
 * one title), so the whole set is small by construction and both callers
 * want all of it anyway.
 *
 * `titles` is a separate top-level array rather than folded into
 * `overrides` as a fifth "kind": GameTitleOverride is a genuinely different
 * kind of correction (renames the Steam shortcut itself, not an image
 * asset) with its own admin route (/api/admin/games/title) and its own
 * table, and stuffing a plain-text title into the `image_url` field of an
 * artwork row would be misleading to any client reading it literally.
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

  const [artworkRows, titleRows] = await Promise.all([
    prisma.gameArtwork.findMany({
      select: { system: true, romStem: true, kind: true, imageUrl: true, updatedAt: true },
    }),
    prisma.gameTitleOverride.findMany({
      select: { system: true, romStem: true, title: true, updatedAt: true },
    }),
  ]);

  return NextResponse.json({
    overrides: artworkRows.map((r) => ({
      system: r.system,
      rom_stem: r.romStem,
      kind: r.kind,
      image_url: r.imageUrl,
      updated_at: r.updatedAt.toISOString(),
    })),
    titles: titleRows.map((r) => ({
      system: r.system,
      rom_stem: r.romStem,
      title: r.title,
      updated_at: r.updatedAt.toISOString(),
    })),
  });
}
