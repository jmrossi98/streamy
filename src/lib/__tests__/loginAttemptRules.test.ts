import { describe, it, expect } from "vitest";
import {
  evaluateLockout,
  attemptWindowStart,
  clientIpFromHeaders,
  ATTEMPT_WINDOW_MINUTES,
  LOCKOUT_MINUTES,
  MAX_FAILURES_PER_NAME,
  MAX_FAILURES_PER_IP,
} from "../loginAttemptRules";

const now = new Date("2026-08-25T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("evaluateLockout", () => {
  it("allows an attempt with no prior failures", () => {
    expect(
      evaluateLockout({ nameFailures: 0, ipFailures: 0, newestFailureAt: null, now })
    ).toEqual({ lockedOut: false });
  });

  it("allows attempts below the per-name limit", () => {
    const state = evaluateLockout({
      nameFailures: MAX_FAILURES_PER_NAME - 1,
      ipFailures: 0,
      newestFailureAt: minutesAgo(1),
      now,
    });
    expect(state.lockedOut).toBe(false);
  });

  it("locks the account at the per-name limit", () => {
    const state = evaluateLockout({
      nameFailures: MAX_FAILURES_PER_NAME,
      ipFailures: 0,
      newestFailureAt: minutesAgo(1),
      now,
    });
    expect(state).toMatchObject({ lockedOut: true, scope: "name" });
  });

  // Spraying: one guess each against many accounts never trips a per-account
  // counter, which is the whole reason the IP ceiling exists.
  it("locks the address at the per-IP limit even with few per-name failures", () => {
    const state = evaluateLockout({
      nameFailures: 1,
      ipFailures: MAX_FAILURES_PER_IP,
      newestFailureAt: minutesAgo(1),
      now,
    });
    expect(state).toMatchObject({ lockedOut: true, scope: "ip" });
  });

  it("reports the per-name scope when both limits are exceeded", () => {
    const state = evaluateLockout({
      nameFailures: MAX_FAILURES_PER_NAME,
      ipFailures: MAX_FAILURES_PER_IP,
      newestFailureAt: minutesAgo(1),
      now,
    });
    expect(state).toMatchObject({ lockedOut: true, scope: "name" });
  });

  it("releases the lockout once it has aged out", () => {
    const state = evaluateLockout({
      nameFailures: MAX_FAILURES_PER_NAME,
      ipFailures: 0,
      newestFailureAt: minutesAgo(LOCKOUT_MINUTES + 1),
      now,
    });
    expect(state.lockedOut).toBe(false);
  });

  it("reports a remaining time that shrinks as the lockout ages", () => {
    const fresh = evaluateLockout({
      nameFailures: MAX_FAILURES_PER_NAME,
      ipFailures: 0,
      newestFailureAt: minutesAgo(1),
      now,
    });
    const older = evaluateLockout({
      nameFailures: MAX_FAILURES_PER_NAME,
      ipFailures: 0,
      newestFailureAt: minutesAgo(LOCKOUT_MINUTES - 2),
      now,
    });
    if (!fresh.lockedOut || !older.lockedOut) throw new Error("expected both to be locked out");
    expect(fresh.retryAfterMinutes).toBeGreaterThan(older.retryAfterMinutes);
    expect(older.retryAfterMinutes).toBeGreaterThanOrEqual(1);
  });

  // Guessing during a lockout should extend it, not run the clock down.
  it("restarts the clock from the newest failure", () => {
    const state = evaluateLockout({
      nameFailures: MAX_FAILURES_PER_NAME + 10,
      ipFailures: 0,
      newestFailureAt: now,
      now,
    });
    if (!state.lockedOut) throw new Error("expected lockout");
    expect(state.retryAfterMinutes).toBe(LOCKOUT_MINUTES);
  });

  it("never locks out without a recorded failure time", () => {
    expect(
      evaluateLockout({
        nameFailures: MAX_FAILURES_PER_NAME,
        ipFailures: MAX_FAILURES_PER_IP,
        newestFailureAt: null,
        now,
      })
    ).toEqual({ lockedOut: false });
  });
});

describe("attemptWindowStart", () => {
  it("looks back exactly the attempt window", () => {
    expect(now.getTime() - attemptWindowStart(now).getTime()).toBe(
      ATTEMPT_WINDOW_MINUTES * 60_000
    );
  });
});

describe("clientIpFromHeaders", () => {
  // Behind Cloudflare this header is set by the edge and can't be forged;
  // x-forwarded-for can be, so precedence is a security property here.
  it("prefers cf-connecting-ip over forwarded headers", () => {
    expect(
      clientIpFromHeaders({
        "cf-connecting-ip": "1.1.1.1",
        "x-real-ip": "2.2.2.2",
        "x-forwarded-for": "3.3.3.3",
      })
    ).toBe("1.1.1.1");
  });

  it("falls back to x-real-ip, then x-forwarded-for", () => {
    expect(clientIpFromHeaders({ "x-real-ip": "2.2.2.2", "x-forwarded-for": "3.3.3.3" })).toBe(
      "2.2.2.2"
    );
    expect(clientIpFromHeaders({ "x-forwarded-for": "3.3.3.3" })).toBe("3.3.3.3");
  });

  it("takes only the first entry of a forwarded chain", () => {
    expect(clientIpFromHeaders({ "x-forwarded-for": "3.3.3.3, 4.4.4.4, 5.5.5.5" })).toBe("3.3.3.3");
  });

  it("handles array-valued headers", () => {
    expect(clientIpFromHeaders({ "cf-connecting-ip": ["1.1.1.1", "9.9.9.9"] })).toBe("1.1.1.1");
  });

  // Must still return a usable grouping key, or attempts can't be counted.
  it("returns a placeholder rather than empty when nothing is present", () => {
    expect(clientIpFromHeaders({})).toBe("unknown");
    expect(clientIpFromHeaders({ "x-forwarded-for": "   " })).toBe("unknown");
  });
});
