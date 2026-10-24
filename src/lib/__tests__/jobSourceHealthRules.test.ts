import { describe, expect, it } from "vitest";
import { SCRAPED_STALE_AFTER_MS, sourceHealth, STALE_AFTER_MS } from "../jobSourceHealthRules";

const now = new Date("2026-09-29T12:00:00Z");
const recent = new Date(now.getTime() - 20 * 60_000);
const base = { enabled: true, lastCheckedAt: recent, lastSuccessAt: recent, lastError: null, lastCount: 12 };

describe("sourceHealth", () => {
  it("is ok after a recent good poll", () => {
    expect(sourceHealth(base, now).status).toBe("ok");
  });
  it("flags an error, and says when it last worked", () => {
    const h = sourceHealth({ ...base, lastError: "HTTP 404" }, now);
    expect(h.status).toBe("failing");
    expect(h.detail).toMatch(/HTTP 404.*Last worked 20m ago/);
  });
  it("flags a board that read fine but returned nothing", () => {
    expect(sourceHealth({ ...base, lastCount: 0 }, now).status).toBe("empty");
  });
  it("flags a board with no good poll for hours", () => {
    const old = new Date(now.getTime() - STALE_AFTER_MS - 1);
    expect(sourceHealth({ ...base, lastSuccessAt: old }, now).status).toBe("stale");
  });
  it("does not judge disabled or never-polled boards", () => {
    expect(sourceHealth({ ...base, enabled: false, lastError: "x" }, now).status).toBe("off");
    expect(sourceHealth({ ...base, lastCheckedAt: null }, now).status).toBe("unchecked");
  });
});

describe("rate limiting and scraped sites (2026-10-24)", () => {
  it("shows a back-off as rate limited with the retry time, not as failing", () => {
    const until = new Date("2026-09-29T14:40:00Z"); // 10:40 Eastern (EDT)
    const h = sourceHealth({ ...base, lastError: "HTTP 429", backoffUntil: until }, now);
    expect(h.status).toBe("limited");
    expect(h.detail).toBe("Rate limited, retrying at 10:40");
  });
  it("goes back to the error once the back-off has passed", () => {
    const past = new Date(now.getTime() - 60_000);
    expect(sourceHealth({ ...base, lastError: "HTTP 429", backoffUntil: past }, now).status).toBe("failing");
  });
  it("gives a 6-hourly scraper a wider stale window", () => {
    const fiveHours = new Date(now.getTime() - 5 * 3600_000);
    const input = { ...base, lastCheckedAt: fiveHours, lastSuccessAt: fiveHours };
    expect(sourceHealth(input, now).status).toBe("stale");
    expect(sourceHealth(input, now, { staleAfterMs: SCRAPED_STALE_AFTER_MS }).status).toBe("ok");
  });
});
