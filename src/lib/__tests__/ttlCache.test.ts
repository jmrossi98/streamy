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
