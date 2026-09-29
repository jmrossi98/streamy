import { describe, expect, it } from "vitest";
import { scrapedSiteHealth, sourceHealth, STALE_AFTER_MS } from "../jobSourceHealthRules";

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

describe("scrapedSiteHealth", () => {
  it("reports the scraper's error, empty pages and a stale report", () => {
    expect(scrapedSiteHealth({ count: 0, error: "HTTP Error 500" }, recent, now).status).toBe("failing");
    expect(scrapedSiteHealth({ count: 0, error: null }, recent, now).status).toBe("empty");
    expect(scrapedSiteHealth({ count: 5, error: null }, new Date(0), now).status).toBe("stale");
    expect(scrapedSiteHealth({ count: 5, error: null }, recent, now).status).toBe("ok");
  });
});
