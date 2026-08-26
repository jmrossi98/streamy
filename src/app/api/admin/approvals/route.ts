import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  // requireAdmin re-reads approved + isAdmin from the database, so this single
  // call replaces the old pair of checks (a JWT claim plus an approval lookup)
  // and closes the gap where the JWT alone decided who was an admin.
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json();
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const action = body?.action === "approve" || body?.action === "deny" ? body.action : "";
  if (!userId || !action) {
    return NextResponse.json({ error: "userId and action required" }, { status: 400 });
  }

  if (action === "approve") {
    const result = await prisma.user.updateMany({
      where: { id: userId, approved: false },
      data: { approved: true },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Pending user not found" }, { status: 404 });
    }
  } else {
    const result = await prisma.user.deleteMany({
      where: { id: userId, approved: false },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Pending user not found" }, { status: 404 });
    }
  }

  return NextResponse.json({ ok: true });
}
