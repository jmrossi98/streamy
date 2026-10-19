import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cached, invalidateCache } from "../ttlCache";

describe("cached", () => {
  beforeEach(() => {
    invalidateCache();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks once inside the TTL", async () => {
    const fn = vi.fn().mockResolvedValue("v");
    expect(await cached("k", 1000, fn)).toBe("v");
    expect(await cached("k", 1000, fn)).toBe("v");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("hands back the old answer at once while refreshing, when asked to", async () => {
    let release!: (v: string) => void;
    const fn = vi
      .fn()
      .mockResolvedValueOnce("old")
      .mockImplementationOnce(() => new Promise<string>((r) => (release = r)));
    const opts = { staleWhileRevalidate: true };
    expect(await cached("k", 1000, fn, opts)).toBe("old");
    vi.advanceTimersByTime(1500);
    // Expired: the old answer comes back immediately and the refresh starts.
    expect(await cached("k", 1000, fn, opts)).toBe("old");
    expect(fn).toHaveBeenCalledTimes(2);
    // Still refreshing: no third call, still the old answer.
    expect(await cached("k", 1000, fn, opts)).toBe("old");
    expect(fn).toHaveBeenCalledTimes(2);
    release("new");
    await Promise.resolve();
    await Promise.resolve();
    expect(await cached("k", 1000, fn, opts)).toBe("new");
  });

  it("keeps the old answer when a background refresh fails, and tries again next time", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce("old")
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue("new");
    const opts = { staleWhileRevalidate: true };
    await cached("k", 1000, fn, opts);
    vi.advanceTimersByTime(1500);
    // The refresh fails behind the scenes; the old answer stands.
    expect(await cached("k", 1000, fn, opts)).toBe("old");
    await Promise.resolve();
    await Promise.resolve();
    // Next call: still the old answer at once, and another refresh is started.
    expect(await cached("k", 1000, fn, opts)).toBe("old");
    expect(fn).toHaveBeenCalledTimes(3);
    await Promise.resolve();
    await Promise.resolve();
    expect(await cached("k", 1000, fn, opts)).toBe("new");
  });

  it("asks again once the TTL is up", async () => {
    const fn = vi.fn().mockResolvedValue("v");
    await cached("k", 1000, fn);
    vi.advanceTimersByTime(1500);
    await cached("k", 1000, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent callers into one call", async () => {
    // The reason this exists: without it a cold cache under a fan-out render
    // still sends N identical requests, which is how Dispatcharr's token
    // endpoint started answering 429.
    let release!: (v: string) => void;
    const fn = vi.fn(() => new Promise<string>((r) => (release = r)));
    const all = Promise.all([
      cached("k", 1000, fn),
      cached("k", 1000, fn),
      cached("k", 1000, fn),
    ]);
    release("v");
    expect(await all).toEqual(["v", "v", "v"]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not cache a rejection", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue("ok");
    await expect(cached("k", 1000, fn)).rejects.toThrow("boom");
    expect(await cached("k", 1000, fn)).toBe("ok");
  });

  it("honours skipCacheIf so a blip doesn't get held onto", async () => {
    const fn = vi.fn().mockResolvedValueOnce(null).mockResolvedValue("ok");
    const opts = { skipCacheIf: (v: string | null) => v === null };
    expect(await cached("k", 1000, fn, opts)).toBeNull();
    expect(await cached("k", 1000, fn, opts)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("keys separately", async () => {
    const fn = vi.fn().mockResolvedValue("v");
    await cached("a", 1000, fn);
    await cached("b", 1000, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("clears a family by prefix", async () => {
    const fn = vi.fn().mockResolvedValue("v");
    await cached("aws:mtd", 1000, fn);
    await cached("other", 1000, fn);
    invalidateCache("aws:");
    await cached("aws:mtd", 1000, fn);
    await cached("other", 1000, fn);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
