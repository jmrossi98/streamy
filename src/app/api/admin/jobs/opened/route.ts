import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Marks a listing as opened.
 *
 * Fire-and-forget from the panel: the click opens the posting in a new tab
 * regardless, so this must never be able to delay or block that. It answers
 * 200 for an id that no longer exists rather than 404, because a posting that
 * has aged out is not an error the person clicking can do anything about.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((id: unknown): id is string => typeof id === "string")
    : typeof body?.id === "string"
      ? [body.id]
      : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // updateMany, so an id that has since aged out is a no-op rather than a throw.
  const { count } = await prisma.jobPosting.updateMany({
    where: { id: { in: ids } },
    data: { openedAt: new Date() },
  });
  return NextResponse.json({ ok: true, marked: count });
}
