import { describe, it, expect } from "vitest";
import { FAILURE_HOLD_MS, STALE_FOR_MS, forgetShared, inBatches, sharedRead } from "../sharedRead";

let n = 0;
const key = () => `test:${++n}`;

describe("sharedRead", () => {
  it("makes one request for callers that arrive together", async () => {
    const k = key();
    let calls = 0;
    let release!: (v: string) => void;
    const read = () => {
      calls++;
      return new Promise<string>((resolve) => (release = resolve));
    };
    const a = sharedRead(k, 1000, read);
    const b = sharedRead(k, 1000, read);
    release("queue");
    expect(await Promise.all([a, b])).toEqual(["queue", "queue"]);
    expect(calls).toBe(1);
  });

  it("reuses an answer for its lifetime, then asks again", async () => {
    const k = key();
    let t = 1_000;
    let calls = 0;
    const read = async () => ++calls;
    expect(await sharedRead(k, 1000, read, { now: () => t })).toBe(1);
    t += 500;
    expect(await sharedRead(k, 1000, read, { now: () => t })).toBe(1);
    t += 600;
    expect(await sharedRead(k, 1000, read, { now: () => t })).toBe(2);
  });

  it("serves the last good answer while the source is failing, without asking every time", async () => {
    const k = key();
    let t = 1_000;
    let calls = 0;
    let fail = false;
    const read = async () => {
      calls++;
      if (fail) throw new Error("timeout");
      return "good";
    };
    await sharedRead(k, 1000, read, { now: () => t });
    fail = true;
    t += 2_000;
    expect(await sharedRead(k, 1000, read, { now: () => t })).toBe("good");
    t += 2_000;
    expect(await sharedRead(k, 1000, read, { now: () => t })).toBe("good");
    expect(calls).toBe(2);
    t += FAILURE_HOLD_MS;
    await sharedRead(k, 1000, read, { now: () => t });
    expect(calls).toBe(3);
  });

  it("fails once the last good answer is too old to stand in", async () => {
    const k = key();
    let t = 1_000;
    let fail = false;
    const read = async () => {
      if (fail) throw new Error("timeout");
      return "good";
    };
    await sharedRead(k, 1000, read, { now: () => t });
    fail = true;
    t += STALE_FOR_MS + 1;
    await expect(sharedRead(k, 1000, read, { now: () => t })).rejects.toThrow("timeout");
  });

  it("fails when there has never been an answer", async () => {
    const k = key();
    const read = async (): Promise<string> => {
      throw new Error("down");
    };
    await expect(sharedRead(k, 1000, read)).rejects.toThrow("down");
    await expect(sharedRead(k, 1000, read)).rejects.toThrow("not asked again yet");
  });

  it("asks again after being told the answer changed", async () => {
    const k = key();
    let calls = 0;
    const read = async () => ++calls;
    await sharedRead(k, 60_000, read);
    forgetShared(k);
    expect(await sharedRead(k, 60_000, read)).toBe(2);
  });
});

describe("per-title reads", () => {
  it("leaves a failed title alone for as long as asked", async () => {
    const k = key();
    let t = 1_000;
    let calls = 0;
    const read = async (): Promise<string> => {
      calls++;
      throw new Error("timeout");
    };
    const opts = { now: () => t, failureHoldMs: 300_000 };
    await expect(sharedRead(k, 1000, read, opts)).rejects.toThrow();
    t += 60_000;
    await expect(sharedRead(k, 1000, read, opts)).rejects.toThrow();
    expect(calls).toBe(1);
    t += 300_000;
    await expect(sharedRead(k, 1000, read, opts)).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it("asks a few at a time and keeps the order", async () => {
    let running = 0;
    let most = 0;
    const out = await inBatches([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      most = Math.max(most, ++running);
      await Promise.resolve();
      running--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(most).toBe(3);
  });
});
