import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { listClaudeCodeChats, openClaudeCodeChat } from "@/lib/claudeCodeChats";
import { isClaudeCodeSessionKey } from "@/lib/claudeCodeNoteRules";

/**
 * Claude Code sessions from the vault: list them, and open one as a saved
 * chat linked to that session (continued here, synced back to Claude Code).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  try {
    return NextResponse.json({ sessions: await listClaudeCodeChats(admin.id) });
  } catch (err) {
    console.error("[claude-code-chats] list failed:", err);
    return NextResponse.json({ error: "Couldn't read Claude Code sessions from the vault." }, { status: 502 });
  }
}

/** {key} */
export async function POST(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
  if (!isClaudeCodeSessionKey(body?.key)) return NextResponse.json({ error: "Invalid session key" }, { status: 400 });
  try {
    const session = await openClaudeCodeChat(admin.id, body.key);
    if (!session) return NextResponse.json({ error: "That session isn't in the vault." }, { status: 404 });
    return NextResponse.json({ session });
  } catch (err) {
    console.error("[claude-code-chats] open failed:", err);
    return NextResponse.json({ error: "Couldn't open that session." }, { status: 502 });
  }
}
