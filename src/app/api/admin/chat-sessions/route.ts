import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { createChatSession, listChatSessions } from "@/lib/chatSessions";
import { sweepChatExports } from "@/lib/chatExport";

/** The admin's saved assistant chats: list (newest first) and create. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  // Catches the vault copies up (chats from before the export existed, or
  // saved while the vault was unreachable). Throttled, and never awaited.
  void sweepChatExports().catch((err) => console.error("[chat-export] sweep failed:", err));
  return NextResponse.json({ sessions: await listChatSessions(admin.id) });
}

/** {title?, backend?, turns?} */
export async function POST(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const session = await createChatSession(admin.id, body);
  return NextResponse.json({ session }, { status: 201 });
}
