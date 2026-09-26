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
import { isUsRemote, matchMetros } from "./jobFilters";
import { isSoftwareRole } from "./jobFilters";

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

export function jobSources(): JobSource[] {
  return parseJobSources(process.env.JOB_BOARD_SOURCES);
}

export function isJobBoardConfigured(): boolean {
  return jobSources().length > 0;
}

/** Whether US-remote roles count as a match, alongside the watched metros. */
function includeRemote(): boolean {
  return process.env.JOB_INCLUDE_REMOTE !== "0";
}

async function fetchBoard(source: JobSource): Promise<JobPosting[]> {
  const res = await fetch(boardUrl(source), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
    // Identifying rather than disguised: these are public endpoints meant to be
    // read, and a plausible UA is how a polite consumer behaves.
    headers: { "User-Agent": "streamy-job-watch/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseBoard(source, await res.json());
}

/** A posting worth storing: a software role in a watched place. */
function keep(posting: JobPosting): { metros: string[]; remote: boolean } | null {
  if (!isSoftwareRole(posting.title)) return null;
  const metros = matchMetros(posting.location).map((m) => m.key);
  const remote = includeRemote() && isUsRemote(posting.location);
  if (metros.length === 0 && !remote) return null;
  return { metros, remote };
}

export async function refreshJobPostings(): Promise<RefreshOutcome> {
  const sources = jobSources();
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
    outcome.errors.push("JOB_BOARD_SOURCES is not set");
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

  const fresh: { posting: JobPosting; metros: string[]; remote: boolean }[] = [];
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

  for (const { posting, metros, remote } of fresh) {
    const data = {
      company: posting.company,
      title: posting.title,
      location: posting.location,
      url: posting.url,
      metros: metros.join(","),
      remote,
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

  const announced = await announceNew();
  outcome.announced = announced.count;
  outcome.notified = announced.notified;
  return outcome;
}

/** Sends one message for everything not yet announced, and stamps them. */
async function announceNew(): Promise<{ count: number; notified: boolean }> {
  const pending = await prisma.jobPosting.findMany({
    where: { notifiedAt: null },
    orderBy: [{ company: "asc" }, { title: "asc" }],
  });
  if (pending.length === 0) return { count: 0, notified: false };

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
    where: { id: { in: pending.map((p) => p.id) } },
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
        postedAt: true,
        firstSeen: true,
      },
    });
  } catch {
    return [];
  }
}
