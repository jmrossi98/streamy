import { describe, expect, it } from "vitest";
import {
  isUnhealthy,
  STALL_GRACE_MINUTES,
  TRANSIENT_GRACE_MINUTES,
} from "../downloadHealthRules";

const base = { errorMessage: null as string | null, ageMinutes: 60, hasProgress: false };

/**
 * These pin the rules behind the Gurren Lagann incident (2026-09-25), where a
 * download could never finish: a 0-seed fansub torrent was judged unhealthy,
 * and healing it cancelled every other episode of the same series -- taking
 * out the movie at 26%, then 29%, then 44%, resetting it to zero each time.
 *
 * The scoping half of that fix lives in downloadHealer.ts (cancel the queue
 * entry, not the series). This file covers the half that is pure policy.
 */
describe("isUnhealthy", () => {
  it("leaves anything inside the grace period alone", () => {
    expect(isUnhealthy({ ...base, ageMinutes: STALL_GRACE_MINUTES - 1 })).toBe(false);
    // Even with an error: a download that errored two minutes ago may still
    // recover on its own, and re-grabbing costs more than waiting.
    expect(
      isUnhealthy({ ...base, ageMinutes: 1, errorMessage: "stalled with no connections" })
    ).toBe(false);
  });

  it("treats a real error past the grace period as dead", () => {
    expect(
      isUnhealthy({ ...base, ageMinutes: 20, errorMessage: "stalled with no connections" })
    ).toBe(true);
  });

  it("gives a torrent still fetching metadata a longer clock", () => {
    // The bug: Sonarr reports "qBittorrent is downloading metadata" in the
    // same field as real errors. Killing at 12 minutes destroyed torrents
    // during the one phase where zero progress is expected.
    const msg = "qBittorrent is downloading metadata";
    expect(isUnhealthy({ ...base, ageMinutes: 15, errorMessage: msg })).toBe(false);
    expect(isUnhealthy({ ...base, ageMinutes: TRANSIENT_GRACE_MINUTES - 1, errorMessage: msg })).toBe(
      false
    );
  });

  it("still gives up on a transient status that never resolves", () => {
    // Not exempt, just patient. A torrent that cannot find metadata in half
    // an hour is not going to.
    expect(
      isUnhealthy({
        ...base,
        ageMinutes: TRANSIENT_GRACE_MINUTES + 1,
        errorMessage: "qBittorrent is downloading metadata",
      })
    ).toBe(true);
  });

  it("matches transient statuses case-insensitively", () => {
    expect(
      isUnhealthy({ ...base, ageMinutes: 15, errorMessage: "Downloading Metadata" })
    ).toBe(false);
  });

  it("does not mistake a real error for a transient one", () => {
    // "delay" appears in the transient list; make sure a genuine failure
    // mentioning something else is not swallowed by a loose substring match.
    expect(
      isUnhealthy({ ...base, ageMinutes: 20, errorMessage: "The download was rejected" })
    ).toBe(true);
  });

  it("kills a silent no-progress download past the grace period", () => {
    expect(isUnhealthy({ ...base, ageMinutes: 20, hasProgress: false })).toBe(true);
    expect(isUnhealthy({ ...base, ageMinutes: 20, hasProgress: true })).toBe(false);
  });
});
