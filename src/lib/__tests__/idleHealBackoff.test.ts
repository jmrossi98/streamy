import { describe, expect, it } from "vitest";
import { idleBackoffMs } from "../downloadHealthRules";

const MIN = 60 * 1000;

/**
 * The healer used to re-search every wanted-but-idle title on a flat 15-minute
 * cooldown with no notion of how many times it had already tried. A title no
 * indexer can supply -- Gurren Lagann's specials, which produced 198 episode
 * searches in four hours -- therefore retried forever.
 *
 * These pin the escalation, because the failure it prevents is invisible:
 * everything still "works", it just never stops.
 */
describe("idleBackoffMs", () => {
  it("leaves the first attempt at the base cooldown", () => {
    // 0 and 1 both mean "has not failed repeatedly yet" -- 0 is a key that was
    // marked by the queue pass without an idle attempt of its own.
    expect(idleBackoffMs(0)).toBe(15 * MIN);
    expect(idleBackoffMs(1)).toBe(15 * MIN);
  });

  it("doubles with each consecutive failed attempt", () => {
    expect(idleBackoffMs(2)).toBe(30 * MIN);
    expect(idleBackoffMs(3)).toBe(60 * MIN);
    expect(idleBackoffMs(4)).toBe(120 * MIN);
    expect(idleBackoffMs(5)).toBe(240 * MIN);
  });

  it("caps at a day rather than growing without bound", () => {
    // Without a cap, a long-lived process would push retries into weeks and
    // the title would effectively be abandoned with no way to tell.
    expect(idleBackoffMs(20)).toBe(24 * 60 * MIN);
    expect(idleBackoffMs(500)).toBe(24 * 60 * MIN);
  });

  it("never returns a shorter wait for more attempts", () => {
    let prev = 0;
    for (let tries = 0; tries <= 40; tries++) {
      const wait = idleBackoffMs(tries);
      expect(wait).toBeGreaterThanOrEqual(prev);
      prev = wait;
    }
  });

  it("reaches the cap quickly enough to matter", () => {
    // The point is that a hopeless title stops hammering indexers the same
    // day, not eventually. Seven attempts is under 24h of real elapsed time.
    expect(idleBackoffMs(7)).toBeLessThanOrEqual(24 * 60 * MIN);
    expect(idleBackoffMs(8)).toBe(24 * 60 * MIN);
  });
});
