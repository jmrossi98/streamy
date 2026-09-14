import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * The subscription list behind the spend overview.
 *
 * Hand-maintained, because nothing can discover it. There is no API for "what
 * has this person signed up for" -- which is precisely why the panel is
 * needed: the list had been forgotten, and a forgotten bill is the one no
 * service will remind you about.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CADENCES = new Set(["monthly", "yearly", "metered", "free"]);

export async function POST(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const cadence = CADENCES.has(body.cadence) ? body.cadence : "monthly";
  const cost = Number(body.cost);

  const sub = await prisma.subscription.create({
    data: {
      name,
      category: typeof body.category === "string" ? body.category.trim() : "",
      // A bad number becomes zero rather than rejecting the row: capturing
      // that a service exists matters more than pricing it precisely, and the
      // figure can be filled in later.
      cost: Number.isFinite(cost) && cost > 0 ? cost : 0,
      cadence,
      url: typeof body.url === "string" ? body.url.trim() : "",
      notes: typeof body.notes === "string" ? body.notes.trim() : "",
    },
  });
  return NextResponse.json({ id: sub.id });
}

export async function PATCH(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Only `active` is togglable here -- cancelling is the edit that matters,
  // and the row is kept rather than deleted so the history stays readable.
  await prisma.subscription.update({
    where: { id },
    data: { active: !!body.active },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await prisma.subscription.deleteMany({ where: { id } });
  return NextResponse.json({ removed: true });
}
