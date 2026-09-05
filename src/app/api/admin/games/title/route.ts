import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/auditLog";

/**
 * Saves a manually-corrected display title for one game, keyed the same way
 * as GameArtwork (system+romStem) -- see GameTitleOverride's own doc comment
 * for why that's the right identity here. Lives in Streamy's own DB, so it
 * survives gamarr rescans/restarts, unlike gamarr's own title field.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) {
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
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!system || !romStem) {
    return NextResponse.json({ error: "system and romStem required" }, { status: 400 });
  }

  if (!title) {
    // Empty title clears the override -- back to whatever romSearchTitle
    // would derive on its own, same "clear this pick" convention the
    // artwork picker uses.
    await prisma.gameTitleOverride.deleteMany({ where: { system, romStem } });
    logAudit(admin.name, "game.title.clear", `${system}/${romStem}`);
    return NextResponse.json({ ok: true, title: null });
  }

  await prisma.gameTitleOverride.upsert({
    where: { system_romStem: { system, romStem } },
    create: { system, romStem, title },
    update: { title },
  });
  logAudit(admin.name, "game.title.save", title, `${system}/${romStem}`);
  return NextResponse.json({ ok: true, title });
}
