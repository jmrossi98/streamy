import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Games an admin has deleted in Streamy that mediabox hasn't removed yet,
 * plus the confirmation endpoint for when it has.
 *
 * Called by mediabox (scripts/rom-delete.py, on a cron) as:
 *   GET  https://<host>/api/games/pending-deletions?secret=<MEDIA_WEBHOOK_SECRET>
 *   POST https://<host>/api/games/pending-deletions?secret=...  {deleted:[{system,rom_stem}]}
 *
 * Same auth as artwork-overrides -- no session, MEDIA_WEBHOOK_SECRET, fails
 * closed when unset -- since this is called from a cron with no browser
 * session. Deliberately a pull: mediabox reaching out means no file-deletion
 * endpoint has to be exposed on the network at all.
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

  const rows = await prisma.gameDeletion.findMany({
    where: { deletedAt: null },
    select: { system: true, romStem: true, title: true, requestedAt: true },
  });

  return NextResponse.json({
    deletions: rows.map((r) => ({
      system: r.system,
      rom_stem: r.romStem,
      title: r.title,
      requested_at: r.requestedAt.toISOString(),
    })),
  });
}

/** Marks deletions as actually carried out, so they stop being handed back. */
export async function POST(request: Request) {
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { deleted?: { system?: unknown; rom_stem?: unknown }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const done = Array.isArray(body.deleted) ? body.deleted : [];
  let confirmed = 0;
  for (const d of done) {
    const system = typeof d.system === "string" ? d.system : "";
    const romStem = typeof d.rom_stem === "string" ? d.rom_stem : "";
    if (!system || !romStem) continue;
    const r = await prisma.gameDeletion.updateMany({
      where: { system, romStem, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    confirmed += r.count;
  }
  return NextResponse.json({ ok: true, confirmed });
}
