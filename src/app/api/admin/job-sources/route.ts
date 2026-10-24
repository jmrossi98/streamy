import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/auditLog";
import { boardUrl, parseJobSources } from "@/lib/jobBoards";
import { setJobAlertLevels, setJobDigestCadenceRaw } from "@/lib/appSettings";
import { DIGEST_CADENCES, DIGEST_CADENCE_LABELS, type DigestCadence } from "@/lib/jobDigestRules";
import { isScrapedProvider, reseedOnEnable } from "@/lib/jobBoardRules";
import { STALE_AFTER_HOURS } from "@/lib/jobPostings";

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
    const tag = String(body?.tag ?? "").trim().toLowerCase() || null;
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
        data: { provider, slug, company, tag },
      });
      logAudit(admin.name, "jobSource.add", `${provider}:${slug}`);
      return NextResponse.json({ ok: true, id: created.id });
    } catch {
      return NextResponse.json({ error: "That board is already in the list." }, { status: 409 });
    }
  }

  // Which job levels are included in alert emails (not per board).
  if (action === "alertLevels") {
    const levels = Array.isArray(body?.levels) ? body.levels.map(String) : [];
    const saved = await setJobAlertLevels(levels);
    logAudit(admin.name, "jobSource.alertLevels", saved.join(",") || "(none)");
    return NextResponse.json({ ok: true, levels: saved });
  }

  // How often queued new-role emails go out (2026-10-24).
  if (action === "digestCadence") {
    const cadence = String(body?.cadence ?? "");
    if (!(DIGEST_CADENCES as readonly string[]).includes(cadence)) {
      return NextResponse.json({ error: "Unknown cadence" }, { status: 400 });
    }
    await setJobDigestCadenceRaw(cadence);
    logAudit(admin.name, "jobSource.digestCadence", DIGEST_CADENCE_LABELS[cadence as DigestCadence]);
    return NextResponse.json({ ok: true, cadence });
  }

  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (action === "remove") {
    const row = await prisma.jobBoardSource.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // A scraped company's row is re-registered from the next scrape report,
    // so removing it would only appear to work. Its Poll switch is what stops
    // the scraper; dropping the site for good is an edit to job-scrape.py.
    if (isScrapedProvider(row.provider)) {
      return NextResponse.json(
        { error: "Custom sites come from the scraper. Turn Poll off to stop scraping it." },
        { status: 400 }
      );
    }
    await prisma.jobBoardSource.delete({ where: { id } });
    // Postings are left alone: they age out on their own once the board stops
    // being polled, and deleting them would also wipe the firstSeen history
    // that makes "new" mean anything.
    logAudit(admin.name, "jobSource.remove", `${row.provider}:${row.slug}`);
    return NextResponse.json({ ok: true });
  }

  if (action === "tag") {
    const tag = String(body?.tag ?? "").trim().toLowerCase() || null;
    const row = await prisma.jobBoardSource.update({ where: { id }, data: { tag } }).catch(() => null);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    logAudit(admin.name, "jobSource.tag", `${row.company} -> ${tag ?? "none"}`);
    return NextResponse.json({ ok: true });
  }

  if (action === "toggle") {
    const field =
      body?.field === "notify" ? "notify" : body?.field === "notifyImmediately" ? "notifyImmediately" : "enabled";
    const value = Boolean(body?.value);
    const before = await prisma.jobBoardSource.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Turning Poll back on after its postings could have aged out would make
    // the next poll find them all again as "new"; that poll seeds silently
    // instead. Clearing the back-off lets a rate-limited board be retried now.
    const extra =
      field === "enabled" && value && !before.enabled
        ? {
            backoffUntil: null,
            backoffStreak: 0,
            ...(reseedOnEnable(before, new Date(), STALE_AFTER_HOURS) ? { seededAt: null } : {}),
          }
        : {};
    const row = await prisma.jobBoardSource
      .update({ where: { id }, data: { [field]: value, ...extra } })
      .catch(() => null);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    logAudit(admin.name, `jobSource.${field}`, `${row.company} ${value ? "on" : "off"}`);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
