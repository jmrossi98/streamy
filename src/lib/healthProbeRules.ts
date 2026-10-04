/**
 * Decision rules for the scheduled health probes.
 *
 * Pure, no imports -- same split as downloadHealthRules.ts and
 * securityRules.ts, so the thresholds can be tested without a network or a
 * database.
 *
 * ## Why these probes and not more status rows
 *
 * The admin panel already reads every integration: Radarr, Sonarr, Prowlarr,
 * SABnzbd, FlareSolverr, Dispatcharr, Jellyfin, Syncthing, Portainer, Ollama.
 * Duplicating that on a timer would add nothing. What it cannot do is notice
 * anything while nobody has the page open, and -- more importantly -- there
 * are failures no reachability check can see at all:
 *
 *   - A file served with HTTP 200 whose contents stopped advancing. The
 *     metrics publisher died on 2026-09-25 and every check stayed green for
 *     nine hours; the chart simply stopped moving, which looks like a quiet
 *     night rather than a broken job.
 *   - A download that finished and can never import. Two Gurren Lagann films
 *     sat in importPending indefinitely because fansub names carry no SxxExx
 *     for Sonarr to parse. Sonarr reported healthy throughout.
 *   - A search that returns nothing usable. Reachable indexers that have
 *     stopped producing acceptable releases look identical to working ones
 *     until someone asks for a title.
 *
 * So these check freshness, stuck states, and whether search still yields
 * something -- not whether a port answers.
 */

export type ProbeStatus = "pass" | "fail" | "skip";

export type ProbeResult = {
  /** Stable identifier. Remediation keys off this, so it must not embed values. */
  id: string;
  name: string;
  status: ProbeStatus;
  detail: string;
};

// ---------------------------------------------------------------- freshness

/**
 * How stale a published artifact may be before it counts as broken.
 *
 * Each is generously above its own publish interval, because a probe that
 * fires on one late cron tick is a probe that gets ignored. metrics-sample
 * runs every 5 minutes, so 30 lets several runs fail before anyone is woken;
 * docs-index is rebuilt by hand, so it gets days rather than hours.
 */
export const FRESHNESS_LIMITS_MINUTES: Record<string, number> = {
  "metrics-24h.json": 30,
  "smart.json": 180,
  // Published by live-channel-check.py every half hour. Generous, because
  // sampling twenty-five streams sequentially is minutes of work and a
  // run that overlaps a busy tuner legitimately takes longer.
  "live-channels.json": 120,
  "disk-usage.json": 120,
  // job-watchdog runs every 5 minutes and publishes on every run, including
  // runs that found nothing -- so a stale file means the watchdog itself has
  // stopped, which is the one failure it cannot report on its own.
  "job-watchdog.json": 30,
  // rom-compress runs hourly and publishes even when a pass does nothing.
  // Generous: one pass can legitimately take the better part of an hour.
  "rom-compress.json": 150,
  // job-scrape runs every six hours. Generous, because a run is nine page
  // renders through a browser shared with Prowlarr and can queue behind an
  // indexer search.
  "scraped-jobs.json": 60 * 9,
  "context.json": 60 * 24 * 14,
  "docs-index.json": 60 * 24 * 14,
};

export function freshnessVerdict(
  artifact: string,
  ageMinutes: number | null
): ProbeResult {
  const id = `freshness.${artifact}`;
  const name = `${artifact} is current`;
  const limit = FRESHNESS_LIMITS_MINUTES[artifact];

  if (limit == null) {
    return { id, name, status: "skip", detail: "no freshness limit defined" };
  }
  if (ageMinutes == null) {
    // Unreadable is not the same as stale, but it is not healthy either --
    // and it is the shape a missing generatedAt takes.
    return { id, name, status: "fail", detail: "no generatedAt could be read" };
  }
  if (ageMinutes > limit) {
    return {
      id,
      name,
      status: "fail",
      detail: `last written ${formatAge(ageMinutes)} ago, limit is ${formatAge(limit)}`,
    };
  }
  return { id, name, status: "pass", detail: `written ${formatAge(ageMinutes)} ago` };
}

export function formatAge(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 60 * 48) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / (60 * 24))}d`;
}

// -------------------------------------------------------------- stuck state

/**
 * An import that has not completed in this long is not slow, it is blocked.
 *
 * A hardlink is instant and a cross-filesystem copy of a large file is a few
 * minutes. Thirty is well past both, and it is the window in which the two
 * Gurren Lagann films sat forever.
 */
export const STUCK_IMPORT_MINUTES = 30;

export function stuckImportVerdict(
  stuck: { title: string; ageMinutes: number }[]
): ProbeResult {
  const id = "stuck.imports";
  const name = "No downloads wedged in import";
  const overdue = stuck.filter((s) => s.ageMinutes >= STUCK_IMPORT_MINUTES);
  if (overdue.length === 0) {
    return { id, name, status: "pass", detail: "nothing waiting to import" };
  }
  const worst = overdue.reduce((a, b) => (a.ageMinutes > b.ageMinutes ? a : b));
  return {
    id,
    name,
    status: "fail",
    detail:
      `${overdue.length} stuck in import, oldest ${formatAge(worst.ageMinutes)}: ` +
      overdue
        .slice(0, 3)
        .map((s) => s.title)
        .join(", "),
  };
}

/**
 * The same release grabbed this many times in an hour is a loop, not retries.
 *
 * Three, because a legitimate re-grab after a genuinely failed download is
 * one or two. The healer bug on 2026-09-25 produced grabs twenty seconds
 * apart and 542 history records, and nothing reported it -- the symptom
 * reaching a human was a download that kept resetting from 44% to 7%.
 */
export const REGRAB_LOOP_THRESHOLD = 3;

/**
 * Grabs per release title, counting each grab *event* once.
 *
 * A season pack writes one history record per episode it covers, all with the
 * same timestamp -- The Vince Staples Show S02 pack read as "6x", a loop, from
 * a single grab. A real loop is the same release grabbed at different times,
 * so records sharing a title and a timestamp are one grab.
 */
export function countGrabEvents(records: { sourceTitle?: string; date?: string }[]): Record<string, number> {
  const events = new Map<string, Set<string>>();
  for (const r of records) {
    const t = r.sourceTitle ?? "";
    if (!t) continue;
    // Seconds, not milliseconds: the per-episode records of one grab can
    // differ in the last digits.
    const at = (r.date ?? "").slice(0, 19);
    if (!events.has(t)) events.set(t, new Set());
    events.get(t)!.add(at);
  }
  return Object.fromEntries([...events].map(([t, s]) => [t, s.size]));
}

export function regrabVerdict(counts: Record<string, number>): ProbeResult {
  const id = "stuck.regrab_loop";
  const name = "No release being re-grabbed in a loop";
  const looping = Object.entries(counts).filter(([, n]) => n >= REGRAB_LOOP_THRESHOLD);
  if (looping.length === 0) {
    return { id, name, status: "pass", detail: "no repeated grabs in the last hour" };
  }
  looping.sort((a, b) => b[1] - a[1]);
  return {
    id,
    name,
    status: "fail",
    detail: looping
      .slice(0, 3)
      .map(([title, n]) => `${n}x ${title.slice(0, 60)}`)
      .join("; "),
  };
}

// ------------------------------------------------------------------ search

/**
 * Fewer usable results than this for a well-known title means search is
 * broken, whatever the indexers report about themselves.
 *
 * One, deliberately. The probe asks for something every tracker carries, so
 * the interesting failure is zero -- indexers reachable and returning
 * nothing, which is what a dead API key or a blocked exit IP looks like.
 * Asking for more would fail on an unlucky title rather than a real fault.
 */
export const MIN_SEARCH_RESULTS = 1;

/** Which indexers an ordinary automatic search asks. Pure, for the search probe. */
export function pickAutomaticIndexers(
  indexers: { id: number; enable?: boolean; appProfileId?: number }[],
  profiles: { id: number; enableAutomaticSearch?: boolean }[],
  benched: { indexerId: number }[]
): number[] {
  const auto = new Set(profiles.filter((p) => p.enableAutomaticSearch).map((p) => p.id));
  const out = new Set(benched.map((b) => b.indexerId));
  return indexers
    .filter((i) => i.enable && i.appProfileId != null && auto.has(i.appProfileId) && !out.has(i.id))
    .map((i) => i.id);
}

export function searchVerdict(title: string, resultCount: number | null): ProbeResult {
  const id = "search.yields_results";
  const name = "Search returns usable releases";
  if (resultCount == null) {
    return { id, name, status: "fail", detail: `search for "${title}" did not complete` };
  }
  if (resultCount < MIN_SEARCH_RESULTS) {
    return {
      id,
      name,
      status: "fail",
      detail: `"${title}" returned no releases -- indexers answer but produce nothing`,
    };
  }
  return { id, name, status: "pass", detail: `"${title}" returned ${resultCount} releases` };
}

// ----------------------------------------------------------------- summary

export function summarise(results: ProbeResult[]): { success: boolean; summary: string } {
  const failed = results.filter((r) => r.status === "fail");
  const ran = results.filter((r) => r.status !== "skip");
  if (failed.length === 0) {
    return { success: true, summary: `${ran.length}/${ran.length} probes passed` };
  }
  return {
    success: false,
    summary: `${failed.length} of ${ran.length} probes failed: ${failed
      .map((f) => f.name)
      .slice(0, 3)
      .join(", ")}`,
  };
}

// ------------------------------------------------------------- stuck jobs

/** How recently a watchdog kill still counts as something to be told about. */
export const KILL_NOTICE_WINDOW_HOURS = 24;

export type WatchdogKill = {
  name?: string;
  reason?: string;
  at?: string;
  outcome?: string;
};

/**
 * Whether a batch job had to be killed for making no progress.
 *
 * Fails on kills inside the notice window rather than on any kill ever
 * recorded: the published file keeps a week of them so a job being killed
 * every single run is visible, but a single kill a fortnight ago is history,
 * not an open problem. The window means this clears itself once the box is
 * quiet again, instead of needing someone to acknowledge it.
 */
export function stuckJobVerdict(
  kills: WatchdogKill[] | null,
  now = new Date()
): ProbeResult {
  const id = "jobs.no_recent_kills";
  const name = "no batch job killed for stalling";
  if (kills === null) {
    return { id, name, status: "skip", detail: "job-watchdog.json unreadable" };
  }

  const cutoff = now.getTime() - KILL_NOTICE_WINDOW_HOURS * 3600_000;
  const recent = kills.filter((k) => {
    const at = k.at ? Date.parse(k.at) : NaN;
    return Number.isFinite(at) && at >= cutoff;
  });

  if (recent.length === 0) {
    return { id, name, status: "pass", detail: "none in the last 24h" };
  }
  const worst = recent
    .slice(-3)
    .map((k) => `${k.name ?? "job"} (${k.reason ?? "no reason recorded"})`)
    .join("; ");
  return {
    id,
    name,
    status: "fail",
    detail: `${recent.length} killed in the last 24h: ${worst}`,
  };
}

export type QuarantinedFile = { path?: string; failures?: number };

/**
 * Whether any source file has been given up on.
 *
 * This fails for as long as a file stays quarantined, which is deliberate:
 * quarantine means the box has stopped wasting a core on it, but the file is
 * still sitting there unconverted and no automatic process will ever pick it
 * up again. Only a person can decide whether to re-dump it, delete it, or
 * accept it as-is, so the signal stays up until they do.
 */
export function quarantineVerdict(files: QuarantinedFile[] | null): ProbeResult {
  const id = "jobs.nothing_quarantined";
  const name = "no ROM quarantined after repeated failures";
  if (files === null) {
    return { id, name, status: "skip", detail: "rom-compress.json unreadable" };
  }
  if (files.length === 0) {
    return { id, name, status: "pass", detail: "none" };
  }
  const names = files
    .slice(0, 5)
    .map((f) => `${(f.path ?? "?").split("/").pop()} (${f.failures ?? "?"} failures)`)
    .join("; ");
  return {
    id,
    name,
    status: "fail",
    detail:
      `${files.length} given up on: ${names}. ` +
      "Re-dump, delete, or leave uncompressed -- nothing will retry them.",
  };
}
