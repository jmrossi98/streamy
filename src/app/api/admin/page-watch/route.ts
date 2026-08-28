import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEgress, checkPage, runAllChecks } from "@/lib/pageWatch";

/**
 * Manage watched pages, and run a check on demand.
 *
 * Admin only, re-read from the database. This endpoint makes the server fetch
 * URLs chosen by the caller, so the gate is what stops it being a
 * general-purpose request proxy for anyone who finds it.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Only http(s), and only absolute URLs.
 *
 * Without this the server would happily fetch file:// or an internal address.
 * That is server-side request forgery, and this box sits on a Tailscale network
 * with Radarr, Sonarr, Jellyfin and qBittorrent on it -- all reachable by name
 * and none expecting a request from their own side of the network.
 */
function validateUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "That isn't a valid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http and https URLs can be watched." };
  }
  const host = parsed.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === "[::1]";
  if (blocked) {
    return { ok: false, error: "Private and loopback addresses can't be watched." };
  }
  return { ok: true, url: parsed.toString() };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const orNull = (v: unknown) => {
  const s = str(v);
  return s.length ? s : null;
};

/** Adds a page. */
export async function POST(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Live verification that watch traffic exits through the VPN, not the box.
  if (body.action === "egress") {
    return NextResponse.json({ ok: true, egress: await checkEgress() });
  }

  // Run-now, for the whole set or a single page, rather than waiting for cron.
  if (body.action === "check") {
    const id = str(body.id);
    if (id) {
      const page = await prisma.watchedPage.findUnique({ where: { id } });
      if (!page) return NextResponse.json({ error: "No such page." }, { status: 404 });
      const outcome = await checkPage(page);
      return NextResponse.json({ ok: true, outcome });
    }
    const result = await runAllChecks();
    return NextResponse.json({ ok: true, ...result });
  }

  const label = str(body.label);
  if (!label) return NextResponse.json({ error: "A name is required." }, { status: 400 });

  const checked = validateUrl(str(body.url));
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const existing = await prisma.watchedPage.findUnique({ where: { url: checked.url } });
  if (existing) {
    return NextResponse.json({ error: "That URL is already being watched." }, { status: 409 });
  }

  const page = await prisma.watchedPage.create({
    data: {
      url: checked.url,
      label,
      artist: orNull(body.artist),
      selector: orNull(body.selector),
      ignorePattern: orNull(body.ignorePattern),
      keywords: orNull(body.keywords),
    },
  });

  // Checked immediately, which establishes the baseline. That first check is
  // deliberately silent -- everything is "new" against no previous state.
  await checkPage(page);

  return NextResponse.json({ ok: true, id: page.id });
}

/** Updates a page: enable/disable, or edit its watch settings. */
export async function PATCH(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = str(body.id);
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if ("keywords" in body) data.keywords = orNull(body.keywords);
  if ("selector" in body) data.selector = orNull(body.selector);
  if ("ignorePattern" in body) data.ignorePattern = orNull(body.ignorePattern);
  if ("artist" in body) data.artist = orNull(body.artist);

  if (!Object.keys(data).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  await prisma.watchedPage.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

/** Removes a page, and its change history and dates with it. */
export async function DELETE(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  // Changes and dates cascade from the schema relation.
  await prisma.watchedPage.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
