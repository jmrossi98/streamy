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

/**
 * A date input's "YYYY-MM-DD", or nothing.
 *
 * Parsed as UTC noon rather than midnight: a bare date parses as UTC
 * midnight, which is the previous evening in every western timezone, so a
 * renewal typed as the 15th displayed as the 14th.
 */
function parseRenewsAt(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const d = new Date(`${raw.trim()}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

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
      renewsAt: parseRenewsAt(body.renewsAt),
      // Created already cancelled when cancelling an auto-detected row (an
      // IPTV line, an indexer) that had no entry of its own to mark.
      active: body.active !== false,
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

  // Any field of the row, each only when sent: a partial edit (just the date,
  // just cancelling) can never blank the others. Cancelling keeps the row
  // rather than deleting it so the history stays readable. Everything became
  // editable on 2026-10-16 -- a price or a plan changes on renewal too, not
  // only the date.
  const text = (k: string) => (typeof body[k] === "string" ? { [k]: (body[k] as string).trim() } : {});
  const cost = Number(body.cost);
  await prisma.subscription.update({
    where: { id },
    data: {
      ...(typeof body.active === "boolean" ? { active: body.active } : {}),
      ...("renewsAt" in body ? { renewsAt: parseRenewsAt(body.renewsAt) } : {}),
      ...(typeof body.name === "string" && body.name.trim() ? { name: body.name.trim() } : {}),
      ...text("category"),
      ...text("url"),
      ...text("notes"),
      ...(CADENCES.has(body.cadence) ? { cadence: body.cadence } : {}),
      ...("cost" in body ? { cost: Number.isFinite(cost) && cost > 0 ? cost : 0 } : {}),
    },
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
