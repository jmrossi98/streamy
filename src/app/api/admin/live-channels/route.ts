import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { clearNotWorking } from "@/lib/liveChannelState";

/**
 * Puts a channel that was hidden for not working back in the lineup
 * (liveChannelStateRules.ts). Failed tunes before now stop counting against
 * it; if it fails for people again, it is hidden again by the same rules.
 *
 * Admin only. Writes one row and never touches the stream: nothing here
 * opens a provider connection.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  let name: unknown;
  try {
    name = ((await request.json()) as { name?: unknown }).name;
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }
  if (typeof name !== "string" || !name.trim() || name.length > 200) {
    return NextResponse.json({ error: "A channel name is required" }, { status: 400 });
  }

  await clearNotWorking(name.trim(), admin.name || admin.id);
  return NextResponse.json({ ok: true });
}
