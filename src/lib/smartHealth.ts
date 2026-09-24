/**
 * Per-disk SMART health, read from the snapshot mediabox publishes.
 *
 * The numbers come from `scripts/smart-report.sh` over there, written hourly
 * from root's crontab because smartctl needs raw device access. Streamy never
 * touches the drives itself -- same split as disk-usage.json, and for the same
 * reason: probing hardware synchronously from a page request is how the
 * 2026-09-15 IO-pressure incident happened.
 *
 * What this is for: the 8TB IronWolf holds the entire media library, and until
 * this existed nothing was reading its SMART attributes at all. A NAS drive's
 * whole advantage is that it warns you before it fails; that is worth nothing
 * unattended.
 */

const PROBE_TIMEOUT_MS = 6_000;

export type SmartDisk = {
  device: string;
  model: string;
  serialTail: string;
  /** null when the drive didn't report an overall assessment. */
  healthPassed: boolean | null;
  temperatureC: number | null;
  powerOnHours: number | null;
  reallocatedSectors: number | null;
  pendingSectors: number | null;
  offlineUncorrectable: number | null;
  crcErrors: number | null;
  /** Attribute names the drive itself has flagged as failed. */
  failingAttributes: string[];
};

export type SmartSnapshot = { generatedAt: string; disks: SmartDisk[] };

/**
 * Above this, say so. Not a failure -- the large-scale drive studies find
 * essentially no correlation between temperature and failure below about
 * 50C -- but it is the point where "fine" stops being obviously true, and a
 * media box whose idle baseline is already in the forties has no headroom for
 * a long import on a hot day.
 */
export const TEMP_WARN_C = 50;

/**
 * Above this it stops being a note and becomes the reason the row is red.
 * Still inside the IronWolf's rated 70C ceiling, deliberately: by the time a
 * drive is sitting at 60C something about the airflow has actually broken,
 * and that is worth interrupting someone over.
 */
export const TEMP_CRITICAL_C = 60;

function baseUrl(): string {
  return process.env.FLASH_LIBRARY_URL?.replace(/\/$/, "") ?? "";
}

export function isSmartHealthConfigured(): boolean {
  return !!baseUrl();
}

/** Null when unconfigured, unreachable, or the snapshot doesn't parse. */
export async function getSmartSnapshot(): Promise<SmartSnapshot | null> {
  const base = baseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/status/smart.json`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<SmartSnapshot> | null;
    if (!body || !Array.isArray(body.disks)) return null;
    return { generatedAt: body.generatedAt ?? "", disks: body.disks as SmartDisk[] };
  } catch {
    return null;
  }
}

/** A disk's problems, in the order a human would want to hear them. */
export function diskProblems(d: SmartDisk): string[] {
  const problems: string[] = [];
  const name = d.device.replace("/dev/", "");

  // The drive's own verdict first: an explicit false here is SMART being as
  // loud as it gets, and outranks anything derived from individual counters.
  if (d.healthPassed === false) problems.push(`${name}: SMART says FAILING`);
  if (d.failingAttributes.length > 0) {
    problems.push(`${name}: ${d.failingAttributes.join(", ")} failed`);
  }

  // Reallocated and pending are the classic pair. Any non-zero value is worth
  // surfacing -- a healthy drive reports zero for its whole life, so "a few"
  // is not a normal reading that happens to be small, it is the start.
  if ((d.reallocatedSectors ?? 0) > 0) {
    problems.push(`${name}: ${d.reallocatedSectors} reallocated sector(s)`);
  }
  if ((d.pendingSectors ?? 0) > 0) {
    problems.push(`${name}: ${d.pendingSectors} pending sector(s)`);
  }
  if ((d.offlineUncorrectable ?? 0) > 0) {
    problems.push(`${name}: ${d.offlineUncorrectable} uncorrectable`);
  }
  // Separated from the platter faults deliberately: CRC errors are the cable,
  // not the disk, and the fix is reseating a SATA connector rather than
  // replacing a drive.
  if ((d.crcErrors ?? 0) > 0) {
    problems.push(`${name}: ${d.crcErrors} CRC error(s) (check the SATA cable)`);
  }
  if ((d.temperatureC ?? 0) >= TEMP_CRITICAL_C) {
    problems.push(`${name}: ${d.temperatureC}C`);
  }
  return problems;
}

export type SmartSummary = {
  ok: boolean;
  detail: string;
};

/**
 * One line for the admin panel, and whether it should be red.
 *
 * Temperature between the warn and critical thresholds is reported but does
 * not fail the row: a warm drive is a thing to know, not a thing to wake up
 * for, and a check that cries wolf about a normal summer afternoon is a check
 * people learn to ignore.
 */
export function summarizeSmart(snapshot: SmartSnapshot): SmartSummary {
  if (snapshot.disks.length === 0) {
    return { ok: false, detail: "Snapshot reported no disks" };
  }

  const problems = snapshot.disks.flatMap(diskProblems);
  if (problems.length > 0) {
    return { ok: false, detail: problems.join("; ") };
  }

  const temps = snapshot.disks
    .map((d) => d.temperatureC)
    .filter((t): t is number => typeof t === "number");
  const hottest = temps.length ? Math.max(...temps) : null;
  const range =
    temps.length === 0
      ? ""
      : temps.length === 1 || Math.min(...temps) === hottest
        ? `, ${hottest}C`
        : `, ${Math.min(...temps)}-${hottest}C`;

  const count = `${snapshot.disks.length} disk${snapshot.disks.length === 1 ? "" : "s"} healthy`;
  const warm =
    hottest !== null && hottest >= TEMP_WARN_C ? " (running warm)" : "";

  return { ok: true, detail: `${count}${range}${warm}` };
}
