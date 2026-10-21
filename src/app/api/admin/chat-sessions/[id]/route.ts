import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { ChatConflictError, deleteChatSession, getChatSession, updateChatSession } from "@/lib/chatSessions";

/** One saved assistant chat: read, edit (title / slot / transcript), delete. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const { id } = await params;
  const session = await getChatSession(admin.id, id);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ session });
}

/** {title?, backend?, turns?, baseTurnCount?} -- only the fields present change. */
export async function PATCH(request: Request, { params }: Ctx) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  try {
    const session = await updateChatSession(admin.id, id, body);
    if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ session });
  } catch (err) {
    // Edited here while a linked Claude Code session added turns: the panel
    // reloads the chat rather than overwrite what was added.
    if (err instanceof ChatConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const { id } = await params;
  if (!(await deleteChatSession(admin.id, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
