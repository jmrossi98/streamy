import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/auditLog";
import { boardUrl, parseJobSources } from "@/lib/jobBoards";

/**
 * Add, remove or adjust a company board.
 *
 * Adding verifies the board answers before storing it. A slug that is wrong by
 * one character returns 200 and an empty list on Greenhouse, so an unverified
 * add would sit in the list looking configured and silently contribute nothing
 * -- which is indistinguishable from a company that simply has no openings.
 */
export const runtime = "nodejs";

const PROBE_TIMEOUT_MS = 15_000;

async function boardAnswers(provider: string, slug: string): Promise<boolean> {
  const [source] = parseJobSources(`${provider}:${slug}`);
  if (!source) return false;
  const url = boardUrl(source);
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: source.provider === "workday" ? "POST" : "GET",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
      headers:
        source.provider === "workday"
          ? { "Content-Type": "application/json", Accept: "application/json" }
          : {},
      body:
        source.provider === "workday"
          ? JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: "" })
          : undefined,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const action = body?.action;

  if (action === "add") {
    const provider = String(body?.provider ?? "").trim().toLowerCase();
    const slug = String(body?.slug ?? "").trim();
    const company = String(body?.company ?? "").trim() || slug;
    if (!parseJobSources(`${provider}:${slug}`).length) {
      return NextResponse.json(
        {
          error:
            "Provider must be greenhouse, ashby or workday, and a Workday slug looks like tenant/wd5/SiteName.",
        },
        { status: 400 }
      );
    }
    if (!(await boardAnswers(provider, slug))) {
      return NextResponse.json(
        { error: `That board didn't answer. Check the slug on ${provider}.` },
        { status: 400 }
      );
    }
    try {
      const created = await prisma.jobBoardSource.create({
        data: { provider, slug, company },
      });
      logAudit(admin.name, "jobSource.add", `${provider}:${slug}`);
      return NextResponse.json({ ok: true, id: created.id });
    } catch {
      return NextResponse.json({ error: "That board is already in the list." }, { status: 409 });
    }
  }

  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (action === "remove") {
    const row = await prisma.jobBoardSource.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await prisma.jobBoardSource.delete({ where: { id } });
    // Postings are left alone: they age out on their own once the board stops
    // being polled, and deleting them would also wipe the firstSeen history
    // that makes "new" mean anything.
    logAudit(admin.name, "jobSource.remove", `${row.provider}:${row.slug}`);
    return NextResponse.json({ ok: true });
  }

  if (action === "toggle") {
    const field = body?.field === "notify" ? "notify" : "enabled";
    const value = Boolean(body?.value);
    const row = await prisma.jobBoardSource
      .update({ where: { id }, data: { [field]: value } })
      .catch(() => null);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    logAudit(admin.name, `jobSource.${field}`, `${row.company} ${value ? "on" : "off"}`);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
