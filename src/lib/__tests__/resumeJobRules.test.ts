import { describe, expect, it } from "vitest";
import {
  bootDecision,
  MAX_ATTEMPTS,
  RECOVER_WITHIN_MS,
  TAKEOVER_AFTER_MS,
  budgetFor,
  canAdvance,
  effectiveStatus,
  INTERRUPTED_ERROR,
  isRenderable,
  JOB_CAP_MS,
  MIN_LISTING_CHARS,
  needsRender,
  OVERRUN_ERROR,
  pickListingText,
  realTextLength,
  resumeLog,
  STALE_AFTER_MS,
  toView,
} from "../resumeJobRules";

const META = "https://www.metacareers.com/profile/job_details/1106176811795569";
const T0 = Date.parse("2026-10-24T19:30:00Z");
const at = (ms: number) => new Date(T0 + ms);
const row = (over: Partial<Parameters<typeof toView>[0]> = {}) => ({
  id: "job1",
  postingId: "scraped:Meta:1106176811795569",
  status: "running",
  step: "Researching and drafting",
  error: null,
  note: null,
  versionId: null,
  startedAt: at(0),
  updatedAt: at(0),
  heartbeatAt: at(0),
  ...over,
});

describe("effectiveStatus", () => {
  it("keeps a running job with a fresh heartbeat running", () => {
    expect(effectiveStatus(row({ heartbeatAt: at(60_000) }), T0 + 90_000)).toEqual({ status: "running", error: null });
  });

  it("reports a running job whose heartbeat stopped as interrupted (a restart killed it)", () => {
    const r = effectiveStatus(row({ heartbeatAt: at(10_000) }), T0 + 10_000 + STALE_AFTER_MS + 1);
    expect(r).toEqual({ status: "failed", error: INTERRUPTED_ERROR });
  });

  it("treats a queued job that never started the same way", () => {
    expect(effectiveStatus(row({ status: "queued" }), T0 + STALE_AFTER_MS + 1).status).toBe("failed");
  });

  it("reports a job past the cap as overrun even while it still beats", () => {
    const now = T0 + JOB_CAP_MS + STALE_AFTER_MS + 1;
    expect(effectiveStatus(row({ heartbeatAt: new Date(now - 1000) }), now)).toEqual({ status: "failed", error: OVERRUN_ERROR });
  });

  it("leaves finished jobs alone however old", () => {
    expect(effectiveStatus(row({ status: "succeeded" }), T0 + 1e9)).toEqual({ status: "succeeded", error: null });
    expect(effectiveStatus(row({ status: "failed", error: "No cloud model" }), T0 + 1e9)).toEqual({ status: "failed", error: "No cloud model" });
  });

  it("treats an unknown status as failed", () => {
    expect(effectiveStatus(row({ status: "weird" }), T0).status).toBe("failed");
  });

  it("toView carries the effective status and ISO dates", () => {
    const v = toView(row(), T0 + STALE_AFTER_MS + 1);
    expect(v.status).toBe("failed");
    expect(v.error).toBe(INTERRUPTED_ERROR);
    expect(v.startedAt).toBe("2026-10-24T19:30:00.000Z");
  });
});

describe("canAdvance", () => {
  it("moves forward through the steps", () => {
    expect(canAdvance({ status: "running", step: "" }, "Reading the listing")).toBe(true);
    expect(canAdvance({ status: "running", step: "Reading the listing" }, "Researching and drafting")).toBe(true);
    expect(canAdvance({ status: "running", step: "Researching and drafting" }, "Saving")).toBe(true); // review skipped
  });

  it("never moves backwards or repeats", () => {
    expect(canAdvance({ status: "running", step: "Reviewing" }, "Researching and drafting")).toBe(false);
    expect(canAdvance({ status: "running", step: "Reviewing" }, "Reviewing")).toBe(false);
  });

  it("never touches a finished job", () => {
    expect(canAdvance({ status: "failed", step: "Reading the listing" }, "Saving")).toBe(false);
    expect(canAdvance({ status: "succeeded", step: "Saving" }, "Saving")).toBe(false);
  });
});

describe("budgetFor", () => {
  it("is the per-call max while there is plenty of time", () => {
    expect(budgetFor(T0, T0 + 10_000, 300_000)).toBe(300_000);
  });
  it("shrinks to what is left of the cap, less a reserve for saving", () => {
    expect(budgetFor(T0, T0 + JOB_CAP_MS - 3 * 60_000, 300_000)).toBe(3 * 60_000 - 15_000);
    expect(budgetFor(T0, T0 + JOB_CAP_MS, 300_000)).toBe(0);
  });
});

describe("render allowlist", () => {
  it("covers the career sites the scraper renders", () => {
    for (const url of [
      META,
      "https://jobs.apple.com/en-us/details/200651071-0836/x",
      "https://www.google.com/about/careers/applications/jobs/results/123",
      "https://bloomberg.avature.net/careers/JobDetail/1",
      "https://jobs.deel.com/deel/job-details/1",
    ]) {
      expect(isRenderable(url), url).toBe(true);
    }
  });

  it("refuses everything else", () => {
    for (const url of [
      "not a url",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://example.com/",
      "https://evilmetacareers.com/",
      "https://metacareers.com.evil.com/",
      "https://www.google.com/search?q=x",
      "https://user:pw@www.metacareers.com/",
      "https://www.metacareers.com:8443/",
      "http://100.84.77.56:8101/runs",
      "https://boards.greenhouse.io/x/jobs/1",
    ]) {
      expect(isRenderable(url), url).toBe(false);
    }
  });
});

describe("listing text fallback", () => {
  const long = "Responsibilities ".repeat(60);

  it("counts letters and digits, not markup chrome or whitespace", () => {
    expect(realTextLength("  -- | -- \n\n ")).toBe(0);
    expect(realTextLength("Senior Engineer 12+")).toBe(16);
  });

  it("renders a Meta page the fetch could not read", () => {
    expect(needsRender("", META)).toBe(true);
    expect(needsRender("Meta Careers. Log in.", META)).toBe(true);
  });

  it("keeps a fetch with enough real text, and never renders an unlisted site", () => {
    expect(needsRender(long, META)).toBe(false);
    expect(needsRender("", "https://boards.greenhouse.io/x/jobs/1")).toBe(false);
    expect(realTextLength(long)).toBeGreaterThanOrEqual(MIN_LISTING_CHARS);
  });

  it("picks the render over a shell, the fetch otherwise, and none when both fail", () => {
    expect(pickListingText("Log in", long)).toEqual({ text: long, source: "render" });
    expect(pickListingText(long, null)).toEqual({ text: long, source: "fetch" });
    expect(pickListingText("short but something", null)).toEqual({ text: "short but something", source: "fetch" });
    expect(pickListingText("", null)).toEqual({ text: "", source: "none" });
    expect(pickListingText("", "")).toEqual({ text: "", source: "none" });
  });
});

describe("resumeLog", () => {
  it("is one greppable line per step", () => {
    expect(resumeLog("Reviewing", 1234.6, { posting: "scraped:Meta:1", error: "timed out" })).toBe(
      '[resume] step=Reviewing ms=1235 posting=scraped:Meta:1 error="timed out"'
    );
  });
});

describe("bootDecision", () => {
  const now = T0 + 10 * 60_000;
  const job = (over: Partial<{ status: string; attempts: number; startedAt: Date; heartbeatAt: Date }> = {}) => ({
    status: "running",
    attempts: 1,
    startedAt: new Date(now - 5 * 60_000),
    heartbeatAt: new Date(now - 60_000),
    ...over,
  });

  it("re-queues a job the last process was running", () => {
    expect(bootDecision(job(), now)).toBe("requeue");
    expect(bootDecision(job({ status: "queued" }), now)).toBe("requeue");
  });
  it("waits while the heartbeat is too fresh to be sure the owner is gone", () => {
    expect(bootDecision(job({ heartbeatAt: new Date(now - 5_000) }), now)).toBe("wait");
    expect(bootDecision(job({ heartbeatAt: new Date(now - TAKEOVER_AFTER_MS - 1) }), now)).toBe("requeue");
  });
  it("fails jobs out of attempts or long abandoned", () => {
    expect(bootDecision(job({ attempts: MAX_ATTEMPTS }), now)).toBe("fail");
    expect(bootDecision(job({ startedAt: new Date(now - RECOVER_WITHIN_MS - 1) }), now)).toBe("fail");
  });
  it("leaves finished jobs alone", () => {
    expect(bootDecision(job({ status: "succeeded" }), now)).toBe("leave");
    expect(bootDecision(job({ status: "failed" }), now)).toBe("leave");
  });
});
