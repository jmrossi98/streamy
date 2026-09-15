import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getDiskUsage, isDiskUsageConfigured } from "../diskUsage";

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  vi.unstubAllEnvs();
});

describe("isDiskUsageConfigured", () => {
  it("is false with no FLASH_LIBRARY_URL", () => {
    vi.stubEnv("FLASH_LIBRARY_URL", "");
    expect(isDiskUsageConfigured()).toBe(false);
  });

  it("is true once FLASH_LIBRARY_URL is set", () => {
    vi.stubEnv("FLASH_LIBRARY_URL", "http://100.84.77.56:8099");
    expect(isDiskUsageConfigured()).toBe(true);
  });
});

describe("getDiskUsage", () => {
  beforeEach(() => {
    vi.stubEnv("FLASH_LIBRARY_URL", "http://100.84.77.56:8099");
  });

  it("returns null when unconfigured", async () => {
    vi.stubEnv("FLASH_LIBRARY_URL", "");
    expect(await getDiskUsage()).toBeNull();
  });

  it("fetches the status path under the flash library's own base URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        totalBytes: 100,
        freeBytes: 10,
        categories: { movies: 1, tv: 2, roms: 3, torrents: 4 },
        generatedAt: "2026-09-15T00:00:00Z",
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await getDiskUsage();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://100.84.77.56:8099/status/disk-usage.json",
      expect.objectContaining({ cache: "no-store" })
    );
    expect(result).toEqual({
      totalBytes: 100,
      freeBytes: 10,
      categories: { movies: 1, tv: 2, roms: 3, torrents: 4 },
      generatedAt: "2026-09-15T00:00:00Z",
    });
  });

  it("returns null on a non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    expect(await getDiskUsage()).toBeNull();
  });

  it("returns null when the body is missing required fields", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ totalBytes: 100 }), // no freeBytes, no categories
    }) as unknown as typeof fetch;
    expect(await getDiskUsage()).toBeNull();
  });

  it("returns null when the request throws (timeout, network error)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("timeout")) as unknown as typeof fetch;
    expect(await getDiskUsage()).toBeNull();
  });

  it("defaults a missing individual category to 0 rather than failing", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        totalBytes: 100,
        freeBytes: 10,
        categories: { movies: 5 }, // tv, roms, torrents absent
      }),
    }) as unknown as typeof fetch;

    const result = await getDiskUsage();
    expect(result?.categories).toEqual({ movies: 5, tv: 0, roms: 0, torrents: 0 });
  });
});
