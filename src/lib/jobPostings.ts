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
 */
import { prisma } from "./db";
import { notify } from "./notify";
import { boardUrl, parseBoard, parseJobSources, type JobPosting, type JobSource } from "./jobBoards";
import {
  classifyLevel,
  classifyRole,
  isUsRemote,
  matchMetros,
  type JobCategory,
  type JobLevel,
} from "./jobFilters";

const FETCH_TIMEOUT_MS = 20_000;

/**
 * Postings not seen for this long are deleted.
 *
 * A role that has come off the board is filled or withdrawn, and keeping it
 * would make the list a growing archive rather than a picture of what is open.
 * Generous enough to ride out a provider returning a short or empty payload for
 * a poll or two.
 */
const STALE_AFTER_HOURS = 72;

/** Announce at most this many in one message; the rest are in the panel. */
const MAX_ANNOUNCED = 12;

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

export type ManagedSource = JobSource & {
  id: string;
  enabled: boolean;
  notify: boolean;
  /** Optional grouping, e.g. "startup". */
  tag: string | null;
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
      provider: r.provider as JobSource["provider"],
      slug: r.slug,
      company: r.company,
      enabled: r.enabled,
      notify: r.notify,
      tag: r.tag,
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
    tag: null,
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

async function fetchBoard(source: JobSource): Promise<JobPosting[]> {
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

export async function refreshJobPostings(): Promise<RefreshOutcome> {
  await seedJobSourcesIfEmpty();
  const all = await jobSources();
  // Disabled rows stay configured but are not polled.
  const sources = all.filter((src) => src.enabled);
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
  if (sources.length === 0) {
    outcome.errors.push(
      all.length === 0 ? "no job boards configured" : "every configured board is disabled"
    );
    return outcome;
  }

  const now = new Date();

  // Per source, so one company's board being down costs that company's roles
  // rather than the whole poll -- and is reported rather than swallowed.
  const results = await Promise.all(
    sources.map(async (source) => {
      try {
        return { source, postings: await fetchBoard(source) };
      } catch (err) {
        return {
          source,
          postings: [] as JobPosting[],
          error: err instanceof Error ? err.message : "unknown error",
        };
      }
    })
  );

  const fresh: {
    posting: JobPosting;
    metros: string[];
    remote: boolean;
    category: JobCategory;
    level: JobLevel;
  }[] = [];
  for (const result of results) {
    if ("error" in result && result.error) {
      outcome.errors.push(`${result.source.company}: ${result.error}`);
      continue;
    }
    outcome.fetched += result.postings.length;
    for (const posting of result.postings) {
      const verdict = keep(posting);
      if (verdict) fresh.push({ posting, ...verdict });
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

  for (const { posting, metros, remote, category, level } of fresh) {
    const data = {
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
      // so it keeps meaning the first time we saw this posting.
      create: { id: posting.id, ...data },
      update: data,
    });
    if (!known.has(posting.id)) outcome.created += 1;
  }

  // Only prune when the poll actually worked. Every source failing would
  // otherwise age out the entire list on a network blip.
  if (outcome.errors.length < sources.length) {
    const cutoff = new Date(now.getTime() - STALE_AFTER_HOURS * 3600_000);
    const { count } = await prisma.jobPosting.deleteMany({
      where: { lastSeen: { lt: cutoff } },
    });
    outcome.removed = count;
  }

  const quiet = new Set(all.filter((src) => !src.notify).map((src) => src.company));
  const announced = await announceNew(quiet);
  outcome.announced = announced.count;
  outcome.notified = announced.notified;
  return outcome;
}

/** Sends one message for everything not yet announced, and stamps them. */
async function announceNew(quiet: Set<string>): Promise<{ count: number; notified: boolean }> {
  const all = await prisma.jobPosting.findMany({
    where: { notifiedAt: null },
    orderBy: [{ company: "asc" }, { title: "asc" }],
  });
  if (all.length === 0) return { count: 0, notified: false };

  // A company can be worth watching without being worth an email. Its postings
  // are still stamped below, so turning notifications back on does not then
  // announce everything it has ever had.
  const pending = all.filter((p) => !quiet.has(p.company));
  if (pending.length === 0) {
    await prisma.jobPosting.updateMany({
      where: { id: { in: all.map((p) => p.id) } },
      data: { notifiedAt: new Date() },
    });
    return { count: 0, notified: false };
  }

  const lines = pending
    .slice(0, MAX_ANNOUNCED)
    .map((p) => `${p.company} — ${p.title}\n  ${p.location}\n  ${p.url}`);
  if (pending.length > MAX_ANNOUNCED) {
    lines.push(`…and ${pending.length - MAX_ANNOUNCED} more in the admin panel.`);
  }

  const subject =
    pending.length === 1
      ? `New role: ${pending[0].company} — ${pending[0].title}`
      : `${pending.length} new roles`;

  let notified = false;
  try {
    notified = await notify(subject, lines.join("\n\n"));
  } catch {
    notified = false;
  }

  // Stamped whether or not the send worked. A failed send is worth one missed
  // notification, not a message that repeats every poll forever -- and the
  // postings are in the panel regardless.
  await prisma.jobPosting.updateMany({
    where: { id: { in: all.map((p) => p.id) } },
    data: { notifiedAt: new Date() },
  });

  return { count: pending.length, notified };
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

export async function getJobPostings(limit = 100): Promise<JobPostingRow[]> {
  try {
    return await prisma.jobPosting.findMany({
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
