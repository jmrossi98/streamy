import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { getApplyToken } from "@/lib/applyPacket";
import { buildUserscript } from "@/lib/applyUserscript";

export const runtime = "nodejs";

/**
 * The userscript with this install's token baked in. Served as .user.js so
 * Tampermonkey/Violentmonkey offer to install it on open. `?rotate=1` issues a
 * new token, which disables any previously installed copy.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const url = new URL(request.url);
  const token = await getApplyToken(url.searchParams.get("rotate") === "1");
  const base = process.env.NEXTAUTH_URL?.replace(/\/$/, "") || url.origin;
  return new Response(buildUserscript(base, token), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Disposition": 'inline; filename="streamy-apply.user.js"',
      "Cache-Control": "no-store",
    },
  });
}
