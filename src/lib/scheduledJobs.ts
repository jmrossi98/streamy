/**
 * One view of everything that runs on a schedule: the probes, and mediabox's
 * cron jobs.
 *
 * These come from two different places for a reason. Probes publish their own
 * verdict, so their history is already in the database. Cron jobs publish
 * nothing -- the only record that one ran is whatever it appended to a log --
 * so mediabox publishes an inventory and this reads it.
 *
 * The parsing half is pure and lives here so it can be tested without a
 * database or a box to fetch from.
 */

export type ProbeLine = {
  status: "pass" | "fail" | "skip";
  name: string;
  detail: string;
};

/**
 * Splits a probe run's stored detail back into per-probe rows.
 *
 * healthProbes.ts renders each result as `STATUS  name: detail` with the status
 * padded to four characters. Reading it back is slightly grubby compared with
 * storing the results structurally, but the alternative is a schema change plus
 * a migration for every run already recorded -- and this format is produced in
 * exactly one place, a few lines from here.
 *
 * Anything that does not match is skipped rather than guessed at: a malformed
 * line means the renderer changed, and inventing a status for it would report
 * health that was never measured.
 */
export function parseProbeDetail(detail: string | null | undefined): ProbeLine[] {
  if (!detail) return [];
  const out: ProbeLine[] = [];
  for (const raw of detail.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const match = /^(PASS|FAIL|SKIP)\s+(.+)$/.exec(line);
    if (!match) continue;
    const status = match[1].toLowerCase() as ProbeLine["status"];
    const rest = match[2];
    // First ": " separates name from detail. A detail containing its own colon
    // is common ("3 killed in the last 24h: chdman"), a *name* containing one
    // is not, so splitting on the first is the right way round.
    const split = rest.indexOf(": ");
    if (split === -1) {
      out.push({ status, name: rest.trim(), detail: "" });
      continue;
    }
    out.push({
      status,
      name: rest.slice(0, split).trim(),
      detail: rest.slice(split + 2).trim(),
    });
  }
  return out;
}

export type CronJob = {
  name: string;
  user: string;
  schedule: string;
  command: string;
  log: string | null;
  lastRun: string | null;
  logBytes: number | null;
  unobservable: boolean;
};

/** How late a job may be, as a multiple of its own interval, before it reads as overdue. */
export const OVERDUE_FACTOR = 3;

/**
 * Minutes between runs for the cron schedules this box actually uses.
 *
 * Deliberately not a general cron parser. Every entry here is a fixed interval
 * or a plain hourly/daily, and a real parser would be a few hundred lines to
 * handle expressions nothing on this box writes. Anything unrecognised returns
 * null, which the caller treats as "cannot judge" rather than as healthy.
 */
export function intervalMinutes(schedule: string): number | null {
  const s = schedule.trim();
  if (s.startsWith("@")) {
    const named: Record<string, number> = {
      "@hourly": 60,
      "@daily": 60 * 24,
      "@midnight": 60 * 24,
      "@weekly": 60 * 24 * 7,
      "@monthly": 60 * 24 * 30,
      "@reboot": 0,
    };
    return named[s.toLowerCase()] ?? null;
  }

  const fields = s.split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dom, , dow] = fields;

  // */N in the minute field, e.g. "*/15 * * * *".
  const everyN = /^\*\/(\d+)$/.exec(minute);
  if (everyN && hour === "*") return Number(everyN[1]);

  // A fixed minute, hourly: "17 * * * *".
  if (/^\d+$/.test(minute) && hour === "*") return 60;

  // A fixed minute and hour: daily, or weekly when a weekday is named.
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    if (dow !== "*" && dow !== "?") return 60 * 24 * 7;
    if (dom !== "*" && dom !== "?") return 60 * 24 * 30;
    return 60 * 24;
  }

  // */N in the hour field, e.g. "0 */6 * * *".
  const everyNHours = /^\*\/(\d+)$/.exec(hour);
  if (everyNHours) return Number(everyNHours[1]) * 60;

  return null;
}

export type JobHealth = "ok" | "overdue" | "unobservable" | "unknown";

/**
 * Whether a cron job looks like it is still running.
 *
 * "unobservable" is its own answer rather than being folded into unknown: a job
 * with no log was never going to report a run, which is a gap in what we can
 * see, not a sign of trouble. Showing it as a problem would train people to
 * ignore the column.
 */
export function jobHealth(job: CronJob, now = new Date()): JobHealth {
  if (job.unobservable || !job.lastRun) return "unobservable";
  const interval = intervalMinutes(job.schedule);
  if (interval === null || interval === 0) return "unknown";
  const ranAt = Date.parse(job.lastRun);
  if (!Number.isFinite(ranAt)) return "unknown";
  const ageMinutes = (now.getTime() - ranAt) / 60_000;
  return ageMinutes > interval * OVERDUE_FACTOR ? "overdue" : "ok";
}
