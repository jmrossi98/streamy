import { describe, it, expect } from "vitest";
import { passwordPushNeeded } from "../jellyfinAccountRules";

const JF = "jf-user-1";
const day = (d: number) => new Date(Date.UTC(2026, 9, d));

describe("passwordPushNeeded", () => {
  it("pushes when there is no row or the pair was never pushed", () => {
    expect(passwordPushNeeded(null, JF)).toBe(true);
    expect(passwordPushNeeded({ jellyfinUserId: JF, jellyfinPasswordSyncedAt: null, passwordChangedAt: null }, JF)).toBe(true);
  });

  it("pushes when the row is linked to a different Jellyfin account", () => {
    expect(passwordPushNeeded({ jellyfinUserId: "other", jellyfinPasswordSyncedAt: day(20), passwordChangedAt: null }, JF)).toBe(true);
  });

  // The bug: setting the same password on every login signed out the Roku.
  it("skips a plain re-login after a push", () => {
    expect(passwordPushNeeded({ jellyfinUserId: JF, jellyfinPasswordSyncedAt: day(20), passwordChangedAt: null }, JF)).toBe(false);
    expect(passwordPushNeeded({ jellyfinUserId: JF, jellyfinPasswordSyncedAt: day(20), passwordChangedAt: day(10) }, JF)).toBe(false);
  });

  it("pushes after a Streamy password change", () => {
    expect(passwordPushNeeded({ jellyfinUserId: JF, jellyfinPasswordSyncedAt: day(10), passwordChangedAt: day(20) }, JF)).toBe(true);
  });
});
