import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { getJellyfinLoginSummary } from "../jellyfinLogins";
import { invalidateCache } from "../ttlCache";

const realFetch = global.fetch;

// The summary is cached for a minute so the Security panel, the visitors log
// and the map share one outbound fetch per render. That cache is module-level
// and therefore outlives a single test: without clearing it, the first case to
// run answers every later one, and the suite passes or fails on test order.
beforeEach(() => {
  invalidateCache("jellyfin:");
});

afterEach(() => {
  global.fetch = realFetch;
  vi.unstubAllEnvs();
  invalidateCache("jellyfin:");
});

describe("getJellyfinLoginSummary", () => {
  it("returns an empty summary when unconfigured", async () => {
    vi.stubEnv("FLASH_LIBRARY_URL", "");
    expect(await getJellyfinLoginSummary()).toEqual({
      checkedUtc: null,
      attempts: [],
      blocked: [],
    });
  });

  it("fetches the status path under the flash library's own base URL", async () => {
    vi.stubEnv("FLASH_LIBRARY_URL", "http://100.84.77.56:8099");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ checked_utc: "2026-09-21T12:00:00Z", attempts: [], blocked: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await getJellyfinLoginSummary();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://100.84.77.56:8099/status/jellyfin-logins.json",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("reverses attempts to most-recent-first", async () => {
    vi.stubEnv("FLASH_LIBRARY_URL", "http://100.84.77.56:8099");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        checked_utc: "2026-09-21T12:00:00Z",
        attempts: [
          { at: "2026-09-21T11:00:00Z", outcome: "succeeded", user: "jake", ip: null },
          { at: "2026-09-21T11:05:00Z", outcome: "failed", user: "admin", ip: "1.2.3.4" },
        ],
        blocked: [],
      }),
    }) as unknown as typeof fetch;

    const result = await getJellyfinLoginSummary();
    expect(result.attempts.map((a) => a.at)).toEqual([
      "2026-09-21T11:05:00Z",
      "2026-09-21T11:00:00Z",
    ]);
  });

  it("keeps ip null for a success row rather than fabricating one", async () => {
    vi.stubEnv("FLASH_LIBRARY_URL", "http://100.84.77.56:8099");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        checked_utc: "2026-09-21T12:00:00Z",
        attempts: [{ at: "2026-09-21T11:00:00Z", outcome: "succeeded", user: "jake", ip: null }],
        blocked: [],
      }),
    }) as unknown as typeof fetch;

    const result = await getJellyfinLoginSummary();
    expect(result.attempts[0].ip).toBeNull();
  });

  it("passes through blocked IPs", async () => {
    vi.stubEnv("FLASH_LIBRARY_URL", "http://100.84.77.56:8099");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        checked_utc: "2026-09-21T12:00:00Z",
        attempts: [],
        blocked: [{ ip: "5.6.7.8", since_utc: "2026-09-20T00:00:00Z" }],
      }),
    }) as unknown as typeof fetch;

    const result = await getJellyfinLoginSummary();
    expect(result.blocked).toEqual([{ ip: "5.6.7.8", sinceUtc: "2026-09-20T00:00:00Z" }]);
  });

  it("drops malformed attempt rows rather than crashing the panel", async () => {
    vi.stubEnv("FLASH_LIBRARY_URL", "http://100.84.77.56:8099");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        checked_utc: "2026-09-21T12:00:00Z",
        attempts: [
          { at: "2026-09-21T11:00:00Z", outcome: "succeeded", user: "jake", ip: null },
          { outcome: "failed" }, // missing at/user
          { at: "2026-09-21T11:01:00Z", outcome: "sideways", user: "x", ip: null }, // bad outcome
        ],
        blocked: [],
      }),
    }) as unknown as typeof fetch;

    const result = await getJellyfinLoginSummary();
    expect(result.attempts).toHaveLength(1);
  });

  it("returns an empty summary on a non-ok response", async () => {
    vi.stubEnv("FLASH_LIBRARY_URL", "http://100.84.77.56:8099");
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    expect(await getJellyfinLoginSummary()).toEqual({
      checkedUtc: null,
      attempts: [],
      blocked: [],
    });
  });

  it("returns an empty summary when the request throws", async () => {
    vi.stubEnv("FLASH_LIBRARY_URL", "http://100.84.77.56:8099");
    global.fetch = vi.fn().mockRejectedValue(new Error("timeout")) as unknown as typeof fetch;
    expect(await getJellyfinLoginSummary()).toEqual({
      checkedUtc: null,
      attempts: [],
      blocked: [],
    });
  });
});
