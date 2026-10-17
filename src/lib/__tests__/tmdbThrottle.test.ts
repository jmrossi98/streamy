import { describe, expect, it } from "vitest";
import { isRetryable, makeLimiter, retryDelayMs, tmdbFetch } from "@/lib/tmdbThrottle";

const res = (status: number, retryAfter?: string) =>
  new Response("{}", { status, headers: retryAfter ? { "retry-after": retryAfter } : {} });

describe("tmdbThrottle", () => {
  it("retries rate limits and server errors, not a missing title", () => {
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(503)).toBe(true);
    expect(isRetryable(404)).toBe(false);
    expect(isRetryable(200)).toBe(false);
  });

  it("waits what Retry-After says, else backs off", () => {
    expect(retryDelayMs(0, "2")).toBe(2000);
    expect(retryDelayMs(0, null)).toBe(500);
    expect(retryDelayMs(3, null)).toBe(4000);
    expect(retryDelayMs(9, null)).toBe(8000);
  });

  it("retries a 429 until it succeeds", async () => {
    const seq = [429, 429, 200];
    const waits: number[] = [];
    const r = await tmdbFetch(async () => res(seq.shift()!, "1"), { wait: async (ms) => waits.push(ms) });
    expect(r.status).toBe(200);
    expect(waits).toEqual([1000, 1000]);
  });

  it("gives up after the retry budget and returns the refusal", async () => {
    let calls = 0;
    const r = await tmdbFetch(async () => (calls++, res(429)), { retries: 2, wait: async () => {} });
    expect(r.status).toBe(429);
    expect(calls).toBe(3);
  });

  it("does not retry a 404", async () => {
    let calls = 0;
    const r = await tmdbFetch(async () => (calls++, res(404)), { wait: async () => {} });
    expect(r.status).toBe(404);
    expect(calls).toBe(1);
  });

  it("never runs more than the limit at once", async () => {
    const run = makeLimiter(3);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        run(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 2));
          active--;
        })
      )
    );
    expect(peak).toBe(3);
  });
});
