import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/auditLog";
import { getAppleNotesKey, getAppleNotesStatus } from "@/lib/appleNotes";

/**
 * The Apple Notes panel: the last sync's status, and the sync key the
 * Shortcut sends. The key is only returned when asked for ({action:
 * "reveal"}), and {action: "rotate"} replaces it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAdmin(await getSession()))) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  return NextResponse.json({ status: await getAppleNotesStatus() });
}

export async function POST(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action === "rotate") {
    logAudit(admin.name, "apple-notes.key.rotate", "sync key replaced");
    return NextResponse.json({ key: await getAppleNotesKey(true) });
  }
  if (body?.action === "reveal") return NextResponse.json({ key: await getAppleNotesKey() });
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
