import { describe, expect, it } from "vitest";
import {
  intervalMinutes,
  jobHealth,
  OVERDUE_FACTOR,
  parseProbeDetail,
  type CronJob,
} from "../scheduledJobs";

describe("parseProbeDetail", () => {
  it("reads back the format healthProbes renders", () => {
    // Verbatim shape: status padded to four, two spaces, name, ": ", detail.
    const detail = [
      "PASS  metrics-24h.json is current: 3m old, limit 30m",
      "FAIL  no batch job killed for stalling: 1 killed in the last 24h: chdman (stalled)",
      "SKIP  live-channels.json is current: FLASH_LIBRARY_URL not set",
    ].join("\n");
    expect(parseProbeDetail(detail)).toEqual([
      { status: "pass", name: "metrics-24h.json is current", detail: "3m old, limit 30m" },
      {
        status: "fail",
        name: "no batch job killed for stalling",
        // The detail's own colon must stay in the detail -- splitting on the
        // last ": " would move half of it into the name.
        detail: "1 killed in the last 24h: chdman (stalled)",
      },
      { status: "skip", name: "live-channels.json is current", detail: "FLASH_LIBRARY_URL not set" },
    ]);
  });

  it("handles a line with no detail", () => {
    expect(parseProbeDetail("PASS  something")).toEqual([
      { status: "pass", name: "something", detail: "" },
    ]);
  });

  it("skips lines it does not recognise rather than guessing a status", () => {
    // A malformed line means the renderer changed. Inventing a status would
    // report health that was never measured.
    expect(parseProbeDetail("something went wrong\nPASS  ok: fine")).toEqual([
      { status: "pass", name: "ok", detail: "fine" },
    ]);
  });

  it("is empty for empty input", () => {
    expect(parseProbeDetail(null)).toEqual([]);
    expect(parseProbeDetail("")).toEqual([]);
    expect(parseProbeDetail("   \n  ")).toEqual([]);
  });
});

describe("intervalMinutes", () => {
  it("handles the schedules this box actually uses", () => {
    expect(intervalMinutes("*/5 * * * *")).toBe(5);
    expect(intervalMinutes("*/15 * * * *")).toBe(15);
    expect(intervalMinutes("*/30 * * * *")).toBe(30);
    // A fixed minute every hour -- how rom-compress and indexer-resync run.
    expect(intervalMinutes("17 * * * *")).toBe(60);
    expect(intervalMinutes("43 * * * *")).toBe(60);
    expect(intervalMinutes("0 */6 * * *")).toBe(360);
    expect(intervalMinutes("30 4 * * *")).toBe(60 * 24);
    expect(intervalMinutes("30 4 * * 0")).toBe(60 * 24 * 7);
  });

  it("handles the named schedules", () => {
    expect(intervalMinutes("@hourly")).toBe(60);
    expect(intervalMinutes("@daily")).toBe(60 * 24);
    expect(intervalMinutes("@reboot")).toBe(0);
  });

  it("returns null for anything it cannot judge", () => {
    // Not a cron parser by design -- unknown means "cannot judge", and the
    // caller must not read that as healthy.
    expect(intervalMinutes("0,15,30 * * * *")).toBeNull();
    expect(intervalMinutes("*/5 1-4 * * *")).toBeNull();
    expect(intervalMinutes("garbage")).toBeNull();
    expect(intervalMinutes("")).toBeNull();
  });
});

const NOW = new Date("2026-09-26T21:00:00Z");

function job(over: Partial<CronJob> = {}): CronJob {
  return {
    name: "thing.sh",
    user: "jaker",
    schedule: "*/15 * * * *",
    command: "./thing.sh >> /var/log/thing.log 2>&1",
    log: "/var/log/thing.log",
    lastRun: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
    logBytes: 100,
    unobservable: false,
    ...over,
  };
}

describe("jobHealth", () => {
  it("is ok when the last run is within its interval", () => {
    expect(jobHealth(job(), NOW)).toBe("ok");
  });

  it("tolerates a few missed ticks before calling it overdue", () => {
    const justInside = job({
      lastRun: new Date(NOW.getTime() - 15 * OVERDUE_FACTOR * 60_000 + 60_000).toISOString(),
    });
    expect(jobHealth(justInside, NOW)).toBe("ok");
    const past = job({
      lastRun: new Date(NOW.getTime() - 15 * OVERDUE_FACTOR * 60_000 - 60_000).toISOString(),
    });
    expect(jobHealth(past, NOW)).toBe("overdue");
  });

  it("calls a job with no log unobservable, not broken", () => {
    // derp-wan-ip-watch.sh is real and redirects nowhere. Flagging it as a
    // problem would train people to ignore the column.
    expect(jobHealth(job({ log: null, lastRun: null, unobservable: true }), NOW)).toBe(
      "unobservable"
    );
  });

  it("does not claim health for a schedule it cannot read", () => {
    expect(jobHealth(job({ schedule: "0,20,40 * * * *" }), NOW)).toBe("unknown");
    expect(jobHealth(job({ lastRun: "not a date" }), NOW)).toBe("unknown");
  });

  it("treats @reboot as unjudgeable rather than overdue", () => {
    // It ran once, at boot. An interval of zero is not a promise to run again.
    expect(jobHealth(job({ schedule: "@reboot" }), NOW)).toBe("unknown");
  });
});
