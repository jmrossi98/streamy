/**
 * Polls the configured job boards, stores what matches, and announces what is
 * new.
 *
 * The filtering rules and the provider parsing are pure modules next door
 * (jobFilters.ts, jobBoards.ts). This is the part that talks to the network and
 * the database.
 *
 * ## What "new" means
 *
 * A posting is new when we have not seen it before, not when the provider says
 * it was posted. Providers backdate, omit the field, and re-timestamp on edits,
 * so `firstSeen` is the only honest basis for "tell me about this one". A
 * posting is announced exactly once: `notifiedAt` is stamped in the same pass,
 * so a re-poll, a retry or a restart cannot announce it twice.
 *
 * ## When it is announced (2026-10-24)
 *
 * Queued postings go out in a digest on the admin's cadence (hourly to weekly,
 * or off); boards marked "Email immediately" go out on the poll that finds
 * them. A board's first successful poll seeds silently. The decisions are in
 * jobDigestRules.ts and jobBoardRules.ts.
 */
import { prisma } from "./db";
import { notify } from "./notify";
import { getJobAlertLevels, getJobDigestCadenceRaw, getJobDigestLastAt, setJobDigestLastAt } from "./appSettings";
import {
  boardUrl,
  customPageUrl,
  CUSTOM_BOARDS,
  parseBoard,
  parseJobSources,
  type JobPosting,
  type JobProvider,
  type JobSource,
} from "./jobBoards";
import {
  filterScrapedByPoll,
  isBackedOff,
  isScrapedProvider,
  nextBackoff,
  scrapedRowSeededAt,
  seedsSilently,
  SCRAPED_PROVIDER,
} from "./jobBoardRules";
import {
  announcementMessage,
  isDigestDue,
  parseDigestCadence,
  planAnnouncements,
  type BoardEmailFlags,
} from "./jobDigestRules";
import {
  classifyLevel,
  classifyRole,
  isUsRemote,
  managementKind,
  matchMetros,
  type JobCategory,
  type JobLevel,
} from "./jobFilters";
import {
  careerExperience,
  EXEC_CHECKS_PER_POLL,
  execHiddenReason,
  extractExecRequirement,
  needsExecCheck,
  type ExecCheck,
} from "./jobManagementRules";

const FETCH_TIMEOUT_MS = 20_000;

/**
 * Postings not seen for this long are deleted.
 *
 * A role that has come off the board is filled or withdrawn, and keeping it
 * would make the list a growing archive rather than a picture of what is open.
 * Generous enough to ride out a provider returning a short or empty payload for
 * a poll or two.
 */
export const STALE_AFTER_HOURS = 72;

/**
 * Postings first seen longer ago than this are archived: hidden from the panel
 * and never announced, even while still listed.
 *
 * A role that has sat open for a month is either hard to fill or evergreen
 * boilerplate, and either way it is no longer news. Archived, not deleted: a
 * deleted posting still on its board would be re-created by the next poll and
 * come back as "new". STALE_AFTER_HOURS deletes it once it leaves the board.
 */
const ARCHIVE_AFTER_DAYS = 30;


export type RefreshOutcome = {
  sources: number;
  fetched: number;
  matched: number;
  created: number;
  removed: number;
  announced: number;
  notified: boolean;
  errors: string[];
};

/** The env var, which now only seeds a fresh install. */
export function seedJobSources(): JobSource[] {
  return parseJobSources(process.env.JOB_BOARD_SOURCES);
}

export type ManagedSource = Omit<JobSource, "provider"> & {
  /** A JobProvider, or "scraped" for a career site mediabox scrapes. */
  provider: JobProvider | typeof SCRAPED_PROVIDER;
  id: string;
  enabled: boolean;
  notify: boolean;
  notifyImmediately: boolean;
  seededAt: Date | null;
  backoffUntil: Date | null;
  backoffStreak: number;
  note: string | null;
  /** Optional grouping, e.g. "startup". */
  tag: string | null;
  lastCheckedAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  lastCount: number | null;
};

/**
 * The boards to poll.
 *
 * Database first, env var only when the table is empty. That ordering is what
 * makes the panel authoritative: once a row exists, editing the secret has no
 * effect, so there is exactly one place a company can be added or removed and
 * no way for the two to disagree silently.
 */
export async function jobSources(): Promise<ManagedSource[]> {
  let rows: ManagedSource[] = [];
  try {
    rows = (
      await prisma.jobBoardSource.findMany({ orderBy: { company: "asc" } })
    ).map((r) => ({
      id: r.id,
      provider: r.provider as ManagedSource["provider"],
      slug: r.slug,
      company: r.company,
      enabled: r.enabled,
      notify: r.notify,
      notifyImmediately: r.notifyImmediately,
      seededAt: r.seededAt,
      backoffUntil: r.backoffUntil,
      backoffStreak: r.backoffStreak,
      note: r.note,
      tag: r.tag,
      lastCheckedAt: r.lastCheckedAt,
      lastSuccessAt: r.lastSuccessAt,
      lastError: r.lastError,
      lastCount: r.lastCount,
    }));
  } catch {
    rows = [];
  }
  if (rows.length > 0) return rows;

  return seedJobSources().map((src) => ({
    ...src,
    id: `${src.provider}:${src.slug}`,
    enabled: true,
    notify: true,
    notifyImmediately: false,
    seededAt: null,
    backoffUntil: null,
    backoffStreak: 0,
    note: null,
    tag: null,
    lastCheckedAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastCount: null,
  }));
}

/**
 * Copies the env var into the table, once.
 *
 * Only when the table is empty, so this cannot undo a deliberate removal: a
 * company deleted in the panel would otherwise come back on the next poll,
 * which is the most annoying possible behaviour.
 */
export async function seedJobSourcesIfEmpty(): Promise<number> {
  try {
    if ((await prisma.jobBoardSource.count()) > 0) return 0;
    const seeds = seedJobSources();
    for (const src of seeds) {
      await prisma.jobBoardSource
        .create({ data: { provider: src.provider, slug: src.slug, company: src.company } })
        .catch(() => undefined);
    }
    return seeds.length;
  } catch {
    return 0;
  }
}

export async function isJobBoardConfigured(): Promise<boolean> {
  return (await jobSources()).length > 0;
}

/** Whether US-remote roles count as a match, alongside the watched metros. */
function includeRemote(): boolean {
  return process.env.JOB_INCLUDE_REMOTE !== "0";
}

/** Identifying rather than disguised: these endpoints are meant to be read. */
const UA = "streamy-job-watch/1.0";

/**
 * Workday returns at most 20 postings per request, so it has to be paged.
 *
 * Capped rather than exhaustive. Nvidia alone answers 1,700 for "software
 * engineer", which at 20 a page is 85 requests to one company every half hour
 * -- disproportionate for a watcher whose job is to notice new postings.
 * Workday returns newest first, so the first few pages are exactly the part
 * that can contain something new.
 */
const WORKDAY_PAGE_SIZE = 20;
const WORKDAY_MAX_PAGES = 5;

/**
 * Narrows at the server instead of fetching everything and discarding.
 *
 * isSoftwareRole still has the final say -- this only avoids transferring
 * thousands of postings to throw nearly all of them away.
 */
const WORKDAY_SEARCH_TEXT = "software engineer";

async function fetchWorkday(source: JobSource): Promise<JobPosting[]> {
  const url = boardUrl(source);
  if (!url) throw new Error("malformed workday slug");

  const all: JobPosting[] = [];
  for (let page = 0; page < WORKDAY_MAX_PAGES; page += 1) {
    const res = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": UA,
      },
      body: JSON.stringify({
        appliedFacets: {},
        limit: WORKDAY_PAGE_SIZE,
        offset: page * WORKDAY_PAGE_SIZE,
        searchText: WORKDAY_SEARCH_TEXT,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const batch = parseBoard(source, await res.json());
    all.push(...batch);
    // A short page is the last page; asking for the next one would just be a
    // wasted round trip against someone else's server.
    if (batch.length < WORKDAY_PAGE_SIZE) break;
  }
  return all;
}

/**
 * Eightfold pages with start/num and reports a total; 50 a page is its cap.
 * Capped for the same reason as Workday -- this watches for new postings, and
 * Netflix alone lists several hundred.
 */
const EIGHTFOLD_PAGE_SIZE = 50;
const EIGHTFOLD_MAX_PAGES = 4;

async function fetchEightfold(source: JobSource): Promise<JobPosting[]> {
  const base = boardUrl(source);
  if (!base) throw new Error("malformed eightfold slug");

  const all: JobPosting[] = [];
  for (let page = 0; page < EIGHTFOLD_MAX_PAGES; page += 1) {
    const url = base.replace(/start=\d+/, `start=${page * EIGHTFOLD_PAGE_SIZE}`);
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const batch = parseBoard(source, await res.json());
    all.push(...batch);
    if (batch.length < EIGHTFOLD_PAGE_SIZE) break;
  }
  return all;
}

/**
 * Pages a single-company API, using whatever that API calls its offset.
 *
 * GitHub counts pages from one; Microsoft counts records from zero. Both are
 * in CUSTOM_BOARDS rather than in branches here, so a fifth API is a config
 * entry and not another loop.
 *
 * Capped like every other paged source: this watches for new postings, and
 * the point is the front of the list, not an exhaustive crawl of someone
 * else's board every half hour.
 */
const CUSTOM_MAX_PAGES = 8;

async function fetchCustomPaged(source: JobSource): Promise<JobPosting[]> {
  const board = CUSTOM_BOARDS[source.provider];
  const base = boardUrl(source);
  if (!board?.offsetParam || !board.pageSize) {
    const res = await fetch(base, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseBoard(source, await res.json());
  }

  const all: JobPosting[] = [];
  for (let page = 0; page < CUSTOM_MAX_PAGES; page += 1) {
    const url = customPageUrl(base, board, page);
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const batch = parseBoard(source, await res.json());
    all.push(...batch);
    if (batch.length < board.pageSize) break;
  }
  return all;
}

async function fetchBoard(source: JobSource): Promise<JobPosting[]> {
  if (source.provider in CUSTOM_BOARDS) return fetchCustomPaged(source);
  if (source.provider === "eightfold") return fetchEightfold(source);
  if (source.provider === "workday") return fetchWorkday(source);

  const res = await fetch(boardUrl(source), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseBoard(source, await res.json());
}

/** A posting worth storing: a role we watch for, in a place we watch. */
function keep(
  posting: JobPosting
): { metros: string[]; remote: boolean; category: JobCategory; level: JobLevel } | null {
  const category = classifyRole(posting.title);
  if (!category) return null;
  const metros = matchMetros(posting.location).map((m) => m.key);
  const remote = includeRemote() && isUsRemote(posting.location);
  if (metros.length === 0 && !remote) return null;
  return { metros, remote, category, level: classifyLevel(posting.title) };
}

type ScrapedSite = { company: string; count: number | null; error: string | null };

type ScrapeReport = {
  generatedAt: Date | null;
  sites: ScrapedSite[];
  postings: JobPosting[];
  error: string | null;
};

/**
 * Roles scraped from career sites that publish no readable API.
 *
 * mediabox renders those pages and publishes the result; this reads the file
 * rather than doing any scraping itself. Each company in it is a "Custom" row
 * in Boards watched (provider "scraped"), registered from the report the first
 * time it appears. Its Poll switch is read back by the scraper through
 * /api/cron/job-scrape-config, and also filtered here (2026-10-24).
 *
 * Returns an empty report on any failure. A scrape that is stale or broken
 * shows up in the health probe on that file and on the rows, not as an
 * exception here that would take the whole poll down with it.
 */
async function fetchScrapeReport(): Promise<ScrapeReport> {
  const empty: ScrapeReport = { generatedAt: null, sites: [], postings: [], error: null };
  const base = process.env.FLASH_LIBRARY_URL?.replace(/\/$/, "");
  if (!base) return empty;
  try {
    const res = await fetch(`${base}/status/scraped-jobs.json`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ...empty, error: `scraped jobs: HTTP ${res.status}` };
    const body = (await res.json()) as {
      generatedAt?: string;
      sites?: { company?: string; count?: number; error?: string | null }[];
      postings?: { id?: string; company?: string; title?: string; location?: string; url?: string }[];
    };
    const generatedAt = body.generatedAt ? new Date(body.generatedAt) : null;
    const rows = Array.isArray(body?.postings) ? body.postings : [];
    return {
      generatedAt: generatedAt && !Number.isNaN(generatedAt.getTime()) ? generatedAt : null,
      sites: (Array.isArray(body.sites) ? body.sites : [])
        .filter((site) => site.company)
        .map((site) => ({
          company: String(site.company),
          count: typeof site.count === "number" ? site.count : null,
          error: site.error ? String(site.error) : null,
        })),
      postings: rows
        .filter((r) => r.id && r.title && r.company)
        .map((r) => ({
          // Namespaced like the API providers, so a scraped role and an API
          // role can never collide on id.
          id: `${SCRAPED_PROVIDER}:${r.company}:${r.id}`,
          company: String(r.company),
          title: String(r.title),
          location: r.location || "Unspecified",
          url: r.url || "",
          // The scrapers read a listing page, which shows a posted date in
          // prose if at all. firstSeen is what "new" means here anyway.
          postedAt: null,
        })),
      error: null,
    };
  } catch (err) {
    return { ...empty, error: `scraped jobs: ${err instanceof Error ? err.message : "unreadable"}` };
  }
}

/**
 * Adds a row for every scraped company the report names that has none yet,
 * and returns the full list. A row is what gives a scraped company its Poll
 * and Email switches.
 */
async function registerScrapedSites(
  all: ManagedSource[],
  report: ScrapeReport,
  now: Date
): Promise<ManagedSource[]> {
  const have = new Set(all.filter((s) => isScrapedProvider(s.provider)).map((s) => s.slug));
  const added: ManagedSource[] = [];
  for (const site of report.sites) {
    if (have.has(site.company)) continue;
    have.add(site.company);
    const stored = await prisma.jobPosting
      .count({ where: { id: { startsWith: `${SCRAPED_PROVIDER}:${site.company}:` } } })
      .catch(() => 0);
    const row = await prisma.jobBoardSource
      .create({
        data: {
          provider: SCRAPED_PROVIDER,
          slug: site.company,
          company: site.company,
          seededAt: scrapedRowSeededAt(stored > 0, now),
        },
      })
      .catch(() => null);
    if (!row) continue;
    added.push({
      id: row.id,
      provider: SCRAPED_PROVIDER,
      slug: row.slug,
      company: row.company,
      enabled: row.enabled,
      notify: row.notify,
      notifyImmediately: row.notifyImmediately,
      seededAt: row.seededAt,
      backoffUntil: null,
      backoffStreak: 0,
      note: null,
      tag: null,
      lastCheckedAt: null,
      lastSuccessAt: null,
      lastError: null,
      lastCount: null,
    });
  }
  return [...all, ...added];
}

/**
 * Writes each board's poll result, so the panel can flag one that has stopped
 * being readable. Never fails the poll: health is a report, not the job.
 *
 * Also where the back-off is advanced or cleared, and where a board's first
 * successful poll marks it seeded.
 */
async function recordSourceHealth(
  results: { source: ManagedSource; postings: JobPosting[]; error?: string }[],
  now: Date
): Promise<void> {
  await Promise.all(
    results.map((r) =>
      prisma.jobBoardSource
        .update({
          where: { id: r.source.id },
          data: {
            ...nextBackoff(r, r.source.backoffStreak, now),
            ...(r.error
              ? { lastCheckedAt: now, lastError: r.error.slice(0, 300) }
              : {
                  lastCheckedAt: now,
                  lastSuccessAt: now,
                  lastError: null,
                  lastCount: r.postings.length,
                  ...(r.source.seededAt ? {} : { seededAt: now }),
                }),
          },
        })
        .catch(() => undefined)
    )
  );
}

/** The scraped companies' health, as of the scraper's own run. */
async function recordScrapedHealth(
  rows: ManagedSource[],
  report: ScrapeReport,
  now: Date
): Promise<void> {
  if (!report.generatedAt) return;
  const at = report.generatedAt;
  const byCompany = new Map(report.sites.map((s) => [s.company, s]));
  await Promise.all(
    rows
      .filter((row) => isScrapedProvider(row.provider) && row.enabled && byCompany.has(row.slug))
      .map((row) => {
        const site = byCompany.get(row.slug)!;
        return prisma.jobBoardSource
          .update({
            where: { id: row.id },
            data: site.error
              ? { lastCheckedAt: at, lastError: site.error.slice(0, 300) }
              : {
                  lastCheckedAt: at,
                  lastSuccessAt: at,
                  lastError: null,
                  lastCount: site.count,
                  ...(row.seededAt ? {} : { seededAt: now }),
                },
          })
          .catch(() => undefined);
      })
  );
}

export async function refreshJobPostings(): Promise<RefreshOutcome> {
  await seedJobSourcesIfEmpty();
  const now = new Date();
  const configured = await jobSources();
  const report = await fetchScrapeReport();
  const all = await registerScrapedSites(configured, report, now);

  // Disabled rows stay configured but are not polled; a board backing off
  // after a 429 is skipped until its back-off ends. Scraped companies are
  // read from the report below, never fetched.
  const sources = all.filter(
    (src) => src.enabled && !isScrapedProvider(src.provider) && !isBackedOff(src, now)
  );
  const outcome: RefreshOutcome = {
    sources: sources.length,
    fetched: 0,
    matched: 0,
    created: 0,
    removed: 0,
    announced: 0,
    notified: false,
    errors: [],
  };
  if (all.length === 0) {
    outcome.errors.push("no job boards configured");
    return outcome;
  }
  if (sources.length === 0 && !all.some((src) => src.enabled)) {
    outcome.errors.push("every configured board is disabled");
    return outcome;
  }

  // Per source, so one company's board being down costs that company's roles
  // rather than the whole poll -- and is reported rather than swallowed.
  const results = await Promise.all(
    sources.map(async (source) => {
      try {
        return { source, postings: await fetchBoard(source as JobSource) };
      } catch (err) {
        return {
          source,
          postings: [] as JobPosting[],
          error: err instanceof Error ? err.message : "unknown error",
        };
      }
    })
  );

  await recordSourceHealth(results, now);
  await recordScrapedHealth(all, report, now);
  if (report.error) outcome.errors.push(report.error);

  // Merged in alongside the boards, so everything downstream -- classifying,
  // metro matching, notifying -- treats them identically. `silent` is the
  // board's first successful poll: what it finds is seeded, not announced.
  const fresh: {
    posting: JobPosting;
    silent: boolean;
    metros: string[];
    remote: boolean;
    category: JobCategory;
    level: JobLevel;
  }[] = [];
  const scrapedRows = new Map(
    all.filter((src) => isScrapedProvider(src.provider)).map((src) => [src.slug, src])
  );
  const scraped = filterScrapedByPoll(report.postings, all);
  outcome.fetched += scraped.length;
  for (const posting of scraped) {
    const verdict = keep(posting);
    const row = scrapedRows.get(posting.company);
    if (verdict) fresh.push({ posting, silent: row ? seedsSilently(row) : false, ...verdict });
  }

  let boardErrors = 0;
  for (const result of results) {
    if ("error" in result && result.error) {
      outcome.errors.push(`${result.source.company}: ${result.error}`);
      boardErrors += 1;
      continue;
    }
    outcome.fetched += result.postings.length;
    const silent = seedsSilently(result.source);
    for (const posting of result.postings) {
      const verdict = keep(posting);
      if (verdict) fresh.push({ posting, silent, ...verdict });
    }
  }
  outcome.matched = fresh.length;

  // Which of these we already knew about, so "created" is accurate even though
  // the write below is an upsert.
  const known = new Set(
    (
      await prisma.jobPosting.findMany({
        where: { id: { in: fresh.map((f) => f.posting.id) } },
        select: { id: true },
      })
    ).map((r) => r.id)
  );

  for (const { posting, silent, metros, remote, category, level } of fresh) {
    // A director/VP posting is stored hidden until its listing has been read
    // (assessExecPostings, below); every other posting is never hidden.
    const exec = managementKind(posting.title) === "exec";
    const data = {
      ...(exec ? {} : { hiddenReason: null }),
      company: posting.company,
      title: posting.title,
      location: posting.location,
      url: posting.url,
      metros: metros.join(","),
      remote,
      category,
      level,
      postedAt: posting.postedAt ? new Date(posting.postedAt) : null,
      lastSeen: now,
    };
    await prisma.jobPosting.upsert({
      where: { id: posting.id },
      // firstSeen is left to its default on create and never written on update,
      // so it keeps meaning the first time we saw this posting. A silent seed
      // is stamped notified on create, so no email ever picks it up.
      create: {
        id: posting.id,
        ...data,
        ...(exec ? { hiddenReason: execHiddenReason({ checkedAt: null, status: null, years: null, managerYears: null }, null) } : {}),
        ...(silent ? { notifiedAt: now } : {}),
      },
      update: data,
    });
    if (!known.has(posting.id)) outcome.created += 1;
  }

  // Only prune when the poll actually worked. Every source failing would
  // otherwise age out the entire list on a network blip.
  if (sources.length > 0 && boardErrors < sources.length) {
    const cutoff = new Date(now.getTime() - STALE_AFTER_HOURS * 3600_000);
    const { count } = await prisma.jobPosting.deleteMany({
      where: { lastSeen: { lt: cutoff } },
    });
    outcome.removed = count;
  }

  await prisma.jobPosting.updateMany({
    where: {
      archivedAt: null,
      firstSeen: { lt: new Date(now.getTime() - ARCHIVE_AFTER_DAYS * 86_400_000) },
    },
    data: { archivedAt: now },
  });

  const announced = await announceNew(all, now);
  // After the announcement, so slow listing reads never hold up the email; a
  // director/VP role shown by this pass is announced on the next poll.
  await assessExecPostings(now).catch((err) =>
    outcome.errors.push(`director/VP check: ${err instanceof Error ? err.message : String(err)}`)
  );
  outcome.announced = announced.count;
  outcome.notified = announced.notified;
  return outcome;
}

/**
 * Jake's years of experience, from the resume knowledge base. Cached: it
 * changes by the month, and reading the vault's Word files and PDFs takes
 * seconds. A failed read is cached briefly so a vault outage costs one
 * attempt per half hour, not one per poll of every director posting.
 */
const EXEC_READ_BUDGET_MS = 60_000;

let experienceCache:{ at: number; years: number | null; ok: boolean } | null = null;
const EXPERIENCE_TTL_MS = 6 * 3600_000;
const EXPERIENCE_RETRY_MS = 30 * 60_000;

async function experienceYears(now: Date): Promise<number | null> {
  const c = experienceCache;
  if (c && now.getTime() - c.at < (c.ok ? EXPERIENCE_TTL_MS : EXPERIENCE_RETRY_MS)) return c.years;
  try {
    const { loadKnowledgeBase } = await import("./resume");
    const bank = await loadKnowledgeBase();
    const exp = careerExperience(
      bank.sources.map((s) => s.text),
      now
    );
    console.log(
      `[jobs] experience years=${exp.years ?? "?"} career=${exp.careerStart?.toISOString().slice(0, 7) ?? "?"} internship=${
        exp.internshipStart?.toISOString().slice(0, 7) ?? "-"
      }`
    );
    experienceCache = { at: now.getTime(), years: exp.years, ok: exp.years !== null };
    return exp.years;
  } catch (err) {
    console.log(`[jobs] experience unreadable: ${err instanceof Error ? err.message : String(err)}`);
    experienceCache = { at: now.getTime(), years: null, ok: false };
    return null;
  }
}

/**
 * Reads the requirement of each director/VP posting not yet read (a few per
 * poll; the same listing path the resume builder uses, render fallback and
 * all) and decides which are shown. See jobManagementRules.ts.
 */
async function assessExecPostings(now: Date): Promise<void> {
  const rows = (
    await prisma.jobPosting.findMany({
      where: { level: "management", archivedAt: null },
      select: {
        id: true,
        title: true,
        url: true,
        reqYears: true,
        reqManagerYears: true,
        reqStatus: true,
        reqCheckedAt: true,
        hiddenReason: true,
      },
    })
  ).filter((r) => managementKind(r.title) === "exec");
  if (rows.length === 0) return;

  const toCheck = (r: (typeof rows)[number]): ExecCheck => ({
    checkedAt: r.reqCheckedAt,
    status: r.reqStatus === "read" || r.reqStatus === "unread" ? r.reqStatus : null,
    years: r.reqYears,
    managerYears: r.reqManagerYears,
  });

  // The poll's caller gives up at 180 s (job-listings.yml); a render can wait
  // a minute for the runner's one slot, so reads stop once this is spent and
  // the rest wait for the next poll.
  const readUntil = Date.now() + EXEC_READ_BUDGET_MS;
  let reads = 0;
  for (const row of rows) {
    if (reads >= EXEC_CHECKS_PER_POLL || Date.now() > readUntil || !needsExecCheck(toCheck(row), now)) continue;
    reads += 1;
    const { readListing } = await import("./resume");
    const listing = await readListing(row.url).catch(() => ({ text: "", source: "none" as const }));
    const req = listing.source === "none" ? { years: null, managerYears: null } : extractExecRequirement(listing.text);
    Object.assign(row, {
      reqYears: req.years,
      reqManagerYears: req.managerYears,
      reqStatus: listing.source === "none" ? "unread" : "read",
      reqCheckedAt: now,
    });
    console.log(
      `[jobs] exec-check posting=${row.id} listing=${listing.source} years=${req.years ?? "-"} managerYears=${req.managerYears ?? "-"}`
    );
    await prisma.jobPosting.update({
      where: { id: row.id },
      data: { reqYears: row.reqYears, reqManagerYears: row.reqManagerYears, reqStatus: row.reqStatus, reqCheckedAt: now },
    });
  }

  const years = await experienceYears(now);
  for (const row of rows) {
    const reason = execHiddenReason(toCheck(row), years);
    if (reason === row.hiddenReason) continue;
    await prisma.jobPosting.update({ where: { id: row.id }, data: { hiddenReason: reason } });
  }
}

async function send(subject: string, body: string): Promise<boolean> {
  try {
    return await notify(subject, body);
  } catch {
    return false;
  }
}

/**
 * Emails what is due -- "Email immediately" boards now, the rest when the
 * digest is due -- and stamps everything it decided about.
 *
 * Stamped whether or not the send worked. A failed send is worth one missed
 * notification, not a message that repeats every poll forever -- and the
 * postings are in the panel regardless.
 */
async function announceNew(
  sources: ManagedSource[],
  now: Date
): Promise<{ count: number; notified: boolean }> {
  const [pending, levels, cadenceRaw, lastDigestAt] = await Promise.all([
    prisma.jobPosting.findMany({
      // A hidden director/VP posting waits here, unannounced, until it is shown.
      where: { notifiedAt: null, archivedAt: null, hiddenReason: null },
      orderBy: [{ company: "asc" }, { title: "asc" }],
    }),
    getJobAlertLevels(),
    getJobDigestCadenceRaw(),
    getJobDigestLastAt(),
  ]);
  const cadence = parseDigestCadence(cadenceRaw);
  const digestDue = isDigestDue(cadence, lastDigestAt, now);

  // By company name, which is what a posting carries. Two rows for one
  // company (an API board and a scraped site) count as on if either is.
  const flags = new Map<string, BoardEmailFlags>();
  for (const src of sources) {
    const prev = flags.get(src.company);
    flags.set(src.company, {
      notify: src.notify || (prev?.notify ?? false),
      notifyImmediately: src.notifyImmediately || (prev?.notifyImmediately ?? false),
    });
  }

  const plan = planAnnouncements(pending, { flags, levels: new Set(levels), cadence, digestDue });
  let notified = false;

  if (plan.immediate.length > 0) {
    const msg = announcementMessage(plan.immediate, "immediate");
    notified = (await send(msg.subject, msg.body)) || notified;
  }
  if (plan.digest.length > 0) {
    const msg = announcementMessage(plan.digest, "digest");
    notified = (await send(msg.subject, msg.body)) || notified;
  }
  // The window restarts whenever the digest is due, sent or not: a fixed
  // rhythm (see isDigestDue).
  if (digestDue) await setJobDigestLastAt(now).catch(() => undefined);

  const stamp = [...plan.immediate, ...plan.digest, ...plan.silent].map((p) => p.id);
  if (stamp.length > 0) {
    await prisma.jobPosting.updateMany({
      where: { id: { in: stamp } },
      data: { notifiedAt: now },
    });
  }

  return { count: plan.immediate.length + plan.digest.length, notified };
}

export type JobPostingRow = {
  id: string;
  company: string;
  title: string;
  location: string;
  url: string;
  metros: string;
  remote: boolean;
  category: string;
  level: string;
  openedAt: Date | null;
  postedAt: Date | null;
  firstSeen: Date;
};

/** Director/VP postings stored but hidden, with the reason, for the panel's folded list. */
export async function getHiddenExecPostings(limit = 200) {
  try {
    const rows = await prisma.jobPosting.findMany({
      where: { archivedAt: null, hiddenReason: { not: null } },
      orderBy: { firstSeen: "desc" },
      take: limit,
      select: { id: true, company: true, title: true, url: true, hiddenReason: true },
    });
    return rows.map((r) => ({ id: r.id, company: r.company, title: r.title, url: r.url, reason: r.hiddenReason ?? "" }));
  } catch {
    return [];
  }
}

export async function getJobPostings(limit = 100): Promise<JobPostingRow[]> {
  try {
    return await prisma.jobPosting.findMany({
      where: { archivedAt: null, hiddenReason: null },
      orderBy: { firstSeen: "desc" },
      take: limit,
      select: {
        id: true,
        company: true,
        title: true,
        location: true,
        url: true,
        metros: true,
        remote: true,
        category: true,
        level: true,
        openedAt: true,
        postedAt: true,
        firstSeen: true,
      },
    });
  } catch {
    return [];
  }
}
