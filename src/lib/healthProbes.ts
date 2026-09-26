/**
 * Scheduled probes for failures the admin panel structurally cannot show.
 *
 * The panel already reads every integration, but only while someone has it
 * open, and only as "does this answer". See healthProbeRules.ts for why
 * freshness, stuck imports and search yield are the three things worth a
 * timer instead.
 *
 * Shaped after playbackCheck.ts deliberately: one row per run, a `notified`
 * flag so an alert that failed to send is visible rather than assumed, and a
 * panel that reads the history. Matching it means the panel and the email
 * come for free instead of being reinvented.
 */
import { prisma } from "./db";
import { isNotifyConfigured, notify } from "./notify";
import {
  FRESHNESS_LIMITS_MINUTES,
  freshnessVerdict,
  regrabVerdict,
  searchVerdict,
  stuckImportVerdict,
  summarise,
  type ProbeResult,
} from "./healthProbeRules";

const TIMEOUT_MS = 12_000;

/**
 * Titles every indexer carries, so a zero-result search means search is
 * broken rather than the title being obscure. Picked at random per run: a
 * fixed title would eventually be cached or specially handled somewhere and
 * stop proving anything.
 */
const SEARCH_PROBE_TITLES = [
  "The Matrix",
  "Jurassic Park",
  "The Godfather",
  "Breaking Bad",
  "The Office",
  "Inception",
  "Forrest Gump",
  "The Simpsons",
];

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Minutes since an ISO timestamp, tolerating both "Z" and "+00" suffixes. */
export function ageMinutes(iso: string | undefined | null, now = Date.now()): number | null {
  if (!iso) return null;
  // "+00" alone is not valid ISO 8601 for Date.parse in every runtime; the
  // publishers emit both that and "Z", so normalise before parsing rather
  // than have half the artifacts read as unparseable.
  const normalised = /[+-]\d{2}$/.test(iso) ? `${iso}:00` : iso;
  const t = Date.parse(normalised);
  if (Number.isNaN(t)) return null;
  return (now - t) / 60_000;
}

async function probeFreshness(): Promise<ProbeResult[]> {
  const base = process.env.FLASH_LIBRARY_URL?.replace(/\/$/, "");
  if (!base) {
    return Object.keys(FRESHNESS_LIMITS_MINUTES).map((a) => ({
      id: `freshness.${a}`,
      name: `${a} is current`,
      status: "skip" as const,
      detail: "FLASH_LIBRARY_URL not set",
    }));
  }
  return Promise.all(
    Object.keys(FRESHNESS_LIMITS_MINUTES).map(async (artifact) => {
      const body = await getJson<{ generatedAt?: string }>(`${base}/status/${artifact}`);
      return freshnessVerdict(artifact, ageMinutes(body?.generatedAt));
    })
  );
}

type QueueRecord = {
  title?: string;
  added?: string;
  trackedDownloadState?: string;
  status?: string;
};

/** Queue entries that finished downloading and never became a library file. */
async function probeStuckImports(): Promise<ProbeResult> {
  const stuck: { title: string; ageMinutes: number }[] = [];

  for (const [base, key, version] of [
    [process.env.RADARR_URL, process.env.RADARR_API_KEY, "v3"],
    [process.env.SONARR_URL, process.env.SONARR_API_KEY, "v3"],
  ] as const) {
    if (!base || !key) continue;
    const q = await getJson<{ records?: QueueRecord[] }>(
      `${base.replace(/\/$/, "")}/api/${version}/queue?pageSize=100`,
      { "X-Api-Key": key }
    );
    for (const r of q?.records ?? []) {
      if (r.trackedDownloadState !== "importPending") continue;
      // `added` is when it entered the queue, which is the only age the queue
      // exposes. Good enough: anything that entered long ago and is still
      // waiting to import is the condition being looked for.
      const age = ageMinutes(r.added);
      stuck.push({ title: r.title ?? "(untitled)", ageMinutes: age ?? Number.MAX_SAFE_INTEGER });
    }
  }
  return stuckImportVerdict(stuck);
}

type HistoryRecord = { sourceTitle?: string; date?: string; eventType?: string };

/** The same release grabbed over and over: a healer loop, not retries. */
async function probeRegrabLoop(): Promise<ProbeResult> {
  const counts: Record<string, number> = {};

  for (const [base, key] of [
    [process.env.RADARR_URL, process.env.RADARR_API_KEY],
    [process.env.SONARR_URL, process.env.SONARR_API_KEY],
  ] as const) {
    if (!base || !key) continue;
    const h = await getJson<{ records?: HistoryRecord[] }>(
      `${base.replace(/\/$/, "")}/api/v3/history?pageSize=200&eventType=1&sortKey=date&sortDirection=descending`,
      { "X-Api-Key": key }
    );
    for (const r of h?.records ?? []) {
      const age = ageMinutes(r.date);
      if (age == null || age > 60) continue;
      const t = r.sourceTitle ?? "";
      if (t) counts[t] = (counts[t] ?? 0) + 1;
    }
  }
  return regrabVerdict(counts);
}

/** Do the indexers still produce releases, not just answer requests? */
async function probeSearch(): Promise<ProbeResult> {
  const base = process.env.PROWLARR_URL?.replace(/\/$/, "");
  const key = process.env.PROWLARR_API_KEY;
  const title = SEARCH_PROBE_TITLES[Math.floor(Math.random() * SEARCH_PROBE_TITLES.length)];
  if (!base || !key) {
    return {
      id: "search.yields_results",
      name: "Search returns usable releases",
      status: "skip",
      detail: "Prowlarr not configured",
    };
  }
  // Prowlarr rather than Radarr/Sonarr: this must not add a movie, monitor
  // anything, or grab. It asks the indexers a question and counts answers.
  const results = await getJson<unknown[]>(
    `${base}/api/v1/search?query=${encodeURIComponent(title)}&type=search&limit=50`,
    { "X-Api-Key": key }
  );
  return searchVerdict(title, Array.isArray(results) ? results.length : null);
}

export type HealthProbeReport = {
  success: boolean;
  summary: string;
  detail: string;
  results: ProbeResult[];
  durationMs: number;
  remediated: string[];
};

export async function runHealthProbes(
  options: { remediate?: boolean } = {}
): Promise<HealthProbeReport> {
  const startedAt = Date.now();

  // In parallel: these touch different systems and one slow indexer should
  // not delay the freshness read that costs 30ms.
  const [freshness, stuckImports, regrab, search] = await Promise.all([
    probeFreshness(),
    probeStuckImports(),
    probeRegrabLoop(),
    probeSearch(),
  ]);

  const results = [...freshness, stuckImports, regrab, search];
  const { success, summary } = summarise(results);
  const detail = results
    .map((r) => `${r.status.toUpperCase().padEnd(4)}  ${r.name}: ${r.detail}`)
    .join("\n");

  let remediated: string[] = [];
  if (!success && options.remediate) {
    const { remediateProbeFailures } = await import("./probeRemediation");
    remediated = await remediateProbeFailures(results);
  }

  const durationMs = Date.now() - startedAt;

  const run = await prisma.healthProbeRun.create({
    data: {
      success,
      summary,
      detail,
      durationMs,
      notified: false,
      remediated: remediated.length > 0 ? remediated.join("\n") : null,
    },
  });

  if (!success && isNotifyConfigured()) {
    const body =
      `${detail}\n\n` +
      (remediated.length > 0
        ? `Attempted automatically:\n${remediated.join("\n")}\n\n`
        : "No automatic action was taken.\n\n") +
      `Ran in ${Math.round(durationMs / 1000)}s.`;
    const sent = await notify(`Health probes failed: ${summary}`, body);
    if (sent) {
      await prisma.healthProbeRun.update({ where: { id: run.id }, data: { notified: true } });
    }
  }

  return { success, summary, detail, results, durationMs, remediated };
}

export type HealthProbeRunRow = {
  id: string;
  ranAt: Date;
  success: boolean;
  summary: string;
  detail: string;
  durationMs: number | null;
  notified: boolean;
  remediated: string | null;
};

export async function getHealthProbeHistory(limit = 10): Promise<HealthProbeRunRow[]> {
  try {
    return await prisma.healthProbeRun.findMany({ orderBy: { ranAt: "desc" }, take: limit });
  } catch {
    return [];
  }
}
