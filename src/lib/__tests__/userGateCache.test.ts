import { describe, expect, it, vi } from "vitest";
import { createUserGateCache, USER_GATE_TTL_MS } from "../userGateCache";

const gate = { approved: true, isAdmin: false, passwordChangedAt: null };

describe("createUserGateCache", () => {
  it("reads the database once per user within the TTL", async () => {
    const load = vi.fn(async () => gate);
    let t = 1_000;
    const cache = createUserGateCache(load, USER_GATE_TTL_MS, () => t);
    expect(await cache.read("u1")).toEqual(gate);
    expect(await cache.read("u1")).toEqual(gate);
    t += USER_GATE_TTL_MS - 1;
    expect(await cache.read("u1")).toEqual(gate);
    expect(load).toHaveBeenCalledTimes(1);
    t += 1;
    await cache.read("u1");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("remembers a missing user too, so a deleted account costs no reads either", async () => {
    const load = vi.fn(async () => null);
    const cache = createUserGateCache(load, USER_GATE_TTL_MS, () => 0);
    expect(await cache.read("gone")).toBeNull();
    expect(await cache.read("gone")).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("forgets one user on demand, so a revoked approval bites at once", async () => {
    let approved = true;
    const load = vi.fn(async () => ({ ...gate, approved }));
    const cache = createUserGateCache(load, USER_GATE_TTL_MS, () => 0);
    await cache.read("u1");
    await cache.read("u2");
    approved = false;
    cache.forget("u1");
    expect((await cache.read("u1"))?.approved).toBe(false);
    expect((await cache.read("u2"))?.approved).toBe(true);
    cache.forget();
    expect(cache.size()).toBe(0);
  });

  it("remembers nothing from a failed read", async () => {
    let fail = true;
    const load = vi.fn(async () => {
      if (fail) throw new Error("db down");
      return gate;
    });
    const cache = createUserGateCache(load, USER_GATE_TTL_MS, () => 0);
    await expect(cache.read("u1")).rejects.toThrow("db down");
    fail = false;
    expect(await cache.read("u1")).toEqual(gate);
  });
});
