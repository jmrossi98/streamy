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

/**
 * "warn" is shown with the rest but is not a failure: it does not turn the
 * run red, send the alert, or trigger remediation. For conditions worth
 * seeing that are normal to have some of -- a few dead IPTV channels.
 */
export type ProbeStatus = "pass" | "warn" | "fail" | "skip";

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

// ------------------------------------------------------------------ live TV

/** How many down channels are named in the detail line before "+N more". */
const DOWN_CHANNELS_NAMED = 6;

export type LiveChannelsReport = {
  generatedAt?: string;
  scanned?: number;
  skippedReason?: string | null;
  channels?: { name?: string; playable?: boolean }[];
};

/**
 * Which live channels answered at the checker's last full scan.
 *
 * Fails -- and so alerts -- only when not one channel responds. Some channels
 * being down is ordinary for IPTV (event channels between events, a station
 * a provider has dropped), and a threshold on the share that were up sent an
 * alert on every patchy afternoon; decided 2026-10-04 that those are to be
 * shown, not mailed. Anything short of all-up is a warning that names what is
 * down. A wide outage with one upstream cause still alerts through the
 * provider reachability probe below.
 *
 * A scan that yielded to a viewer is skipped, not failed: it did not look at
 * most channels, so it cannot say they are down.
 */
export function liveChannelsVerdict(report: LiveChannelsReport | null): ProbeResult {
  const id = "live.channels_responding";
  const name = "Live channels respond";
  if (report === null || !Array.isArray(report.channels)) {
    return { id, name, status: "skip", detail: "live-channels.json unreadable" };
  }
  if (report.skippedReason) {
    return { id, name, status: "skip", detail: `last scan yielded to live TV (${report.skippedReason})` };
  }
  const total = report.channels.length;
  if (total === 0) return { id, name, status: "skip", detail: "no channels in the lineup" };
  const down = report.channels.filter((c) => c.playable !== true);
  const ok = total - down.length;
  if (ok === 0) return { id, name, status: "fail", detail: `none of ${total} channels responding` };
  if (down.length === 0) return { id, name, status: "pass", detail: `all ${total} channels responding` };
  const named = down.slice(0, DOWN_CHANNELS_NAMED).map((c) => (c.name ?? "(unnamed)").trim());
  const more = down.length > named.length ? ` +${down.length - named.length} more` : "";
  return {
    id,
    name,
    status: "warn",
    detail: `${ok} of ${total} channels responding; down: ${named.join(", ")}${more}`,
  };
}

export type ProviderReachability = {
  provider?: string;
  primaryReachable?: boolean;
  standbyReachable?: boolean;
};

export type VpnFailoverReport = {
  checked_at?: string;
  providers?: ProviderReachability[];
  pending?: string;
};

/**
 * Whether each IPTV provider can be reached through the VPN tunnel live TV
 * uses -- the usual cause when many channels die together. Says which case it
 * is: cut off from this exit only (the standby still connects, a rotation
 * fixes it), or unreachable from everywhere (the provider itself is down).
 */
export function providerReachabilityVerdict(report: VpnFailoverReport | null, now = new Date()): ProbeResult {
  const id = "live.providers_reachable";
  const name = "IPTV providers reachable through the VPN";
  if (report === null || !Array.isArray(report.providers)) {
    return { id, name, status: "skip", detail: "provider reachability not published" };
  }
  const at = report.checked_at ? Date.parse(report.checked_at) : NaN;
  const age = Number.isFinite(at) ? (now.getTime() - at) / 60_000 : Infinity;
  if (age > 20) {
    return { id, name, status: "fail", detail: `the reachability check last ran ${Number.isFinite(age) ? `${Math.round(age)}m` : "never"} ago` };
  }
  const down = report.providers.filter((p) => p.primaryReachable === false);
  if (down.length === 0) return { id, name, status: "pass", detail: `${report.providers.length} providers reachable` };
  const detail = down
    .map((p) =>
      p.standbyReachable
        ? `${p.provider} is unreachable from the current VPN exit but reachable from the standby tunnel (the exit address is blocked; a region rotation fixes it)`
        : `${p.provider} is unreachable from both tunnels (the provider itself looks down)`
    )
    .join("; ");
  return { id, name, status: "fail", detail: report.pending ? `${detail}. ${report.pending}` : detail };
}

/** The exit-node check runs every 2 minutes; this long without one means it has stopped. */
export const EXIT_NODE_STALE_MINUTES = 15;

export type ExitNodeReport = {
  generatedAt?: string;
  ok?: boolean;
  usable?: boolean;
  summary?: string;
};

/**
 * Whether the Tailscale exit nodes can carry traffic, from mediabox's own
 * end-to-end check (scripts/exit-node-health.py): tunnel egress, DNS,
 * return-path rules, forwarding, approval. Nothing watched them before, so an
 * outage could only be noticed by someone away from home with no internet.
 */
export function exitNodeVerdict(report: ExitNodeReport | null, now = new Date()): ProbeResult {
  const id = "exit_nodes.healthy";
  const name = "Tailscale exit nodes pass traffic";
  if (report === null) return { id, name, status: "skip", detail: "exit-nodes.json unreadable" };
  const at = report.generatedAt ? Date.parse(report.generatedAt) : NaN;
  const age = Number.isFinite(at) ? (now.getTime() - at) / 60_000 : Infinity;
  if (age > EXIT_NODE_STALE_MINUTES) {
    return { id, name, status: "fail", detail: `the exit-node check last ran ${Number.isFinite(age) ? `${Math.round(age)}m` : "never"} ago` };
  }
  if (report.ok) return { id, name, status: "pass", detail: "both exit nodes healthy" };
  const what = report.summary || "an exit node is unhealthy";
  return {
    id,
    name,
    status: "fail",
    detail: report.usable ? `${what} (the other node still works)` : `${what} -- no exit node is usable`,
  };
}

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
  const warned = results.filter((r) => r.status === "warn");
  if (failed.length === 0) {
    // Warnings are counted in the summary so they are seen, but the run is a
    // success: nothing is sent and nothing is restarted for them.
    const passed = ran.length - warned.length;
    const warnings = warned.length > 0 ? `, ${warned.length} warning${warned.length === 1 ? "" : "s"}` : "";
    return { success: true, summary: `${passed}/${ran.length} probes passed${warnings}` };
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

// ------------------------------------------------------- download clients

/** The check runs every 10 minutes; this long without one means it has stopped. */
export const DOWNLOAD_CLIENTS_STALE_MINUTES = 45;

export type DownloadClientsReport = {
  generatedAt?: string;
  torrentPort?: { ok?: boolean; detail?: string };
  usenet?: { name?: string; ok?: boolean; error?: string | null }[];
};

/**
 * The two download-client faults that the clients themselves report as fine,
 * from mediabox's own check (scripts/download-clients-health.py).
 *
 * qBittorrent off the forwarded port still downloads, over the few peers it
 * can dial out to: from 2026-09-30 to 10-04 the port push failed on a wrong
 * password and the only symptom was 4K torrents with two-day ETAs. A usenet
 * provider refusing its login leaves SABnzbd running on the others, so older
 * posts fail as incomplete and read as bad releases: Newshosting was refused
 * for six hours on 2026-10-04, and the healer blocklisted what failed.
 */
export function downloadClientsVerdicts(report: DownloadClientsReport | null, now = new Date()): ProbeResult[] {
  const port = { id: "downloads.torrent_port", name: "qBittorrent listens on the forwarded port" };
  const usenet = { id: "downloads.usenet_logins", name: "Usenet providers accept their logins" };
  if (report === null) {
    return [port, usenet].map((p) => ({ ...p, status: "skip" as const, detail: "download-clients.json unreadable" }));
  }
  const at = report.generatedAt ? Date.parse(report.generatedAt) : NaN;
  const age = Number.isFinite(at) ? (now.getTime() - at) / 60_000 : Infinity;
  if (age > DOWNLOAD_CLIENTS_STALE_MINUTES) {
    const detail = `the download-client check last ran ${Number.isFinite(age) ? `${Math.round(age)}m` : "never"} ago`;
    return [port, usenet].map((p) => ({ ...p, status: "fail" as const, detail }));
  }
  const refused = (report.usenet ?? []).filter((s) => !s.ok);
  const servers = report.usenet?.length ?? 0;
  return [
    report.torrentPort?.ok
      ? { ...port, status: "pass", detail: report.torrentPort.detail ?? "ports match" }
      : { ...port, status: "fail", detail: report.torrentPort?.detail ?? "port state missing from the report" },
    refused.length > 0
      ? {
          ...usenet,
          status: "fail",
          detail: refused.map((s) => `${s.name ?? "a provider"}: ${s.error ?? "refused"}`).join("; "),
        }
      : servers === 0
        ? { ...usenet, status: "fail", detail: "no usenet provider is configured in SABnzbd" }
        : { ...usenet, status: "pass", detail: `${servers} provider${servers === 1 ? "" : "s"} logged in` },
  ];
}
