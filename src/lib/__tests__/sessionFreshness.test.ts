import { describe, it, expect } from "vitest";
import { isSessionStale, passwordStamp } from "../sessionFreshness";

const at = (iso: string) => new Date(iso);

describe("passwordStamp", () => {
  it("is 0 for an account whose password has never been changed", () => {
    expect(passwordStamp(null)).toBe(0);
    expect(passwordStamp(undefined)).toBe(0);
  });

  it("is the epoch ms of the change", () => {
    const d = at("2026-08-25T12:00:00Z");
    expect(passwordStamp(d)).toBe(d.getTime());
  });
});

describe("isSessionStale", () => {
  // The migration adds a null column, so every pre-existing token carries 0.
  // Those sessions must survive the deploy -- signing out every user is not an
  // acceptable side effect of adding a column.
  it("keeps existing sessions valid when no password has ever been changed", () => {
    expect(isSessionStale(0, null)).toBe(false);
    expect(isSessionStale(undefined, null)).toBe(false);
  });

  it("keeps a token minted against the current password", () => {
    const d = at("2026-08-25T12:00:00Z");
    expect(isSessionStale(d.getTime(), d)).toBe(false);
  });

  // The point of the whole mechanism.
  it("invalidates a token issued before the password changed", () => {
    expect(isSessionStale(0, at("2026-08-25T12:00:00Z"))).toBe(true);
    expect(
      isSessionStale(at("2026-08-01T00:00:00Z").getTime(), at("2026-08-25T12:00:00Z"))
    ).toBe(true);
  });

  // A backup restore or a clock stepping backwards moves the stored stamp to an
  // older value. The token still wasn't minted against the current password, so
  // a `token < stored` comparison would wrongly let it through.
  it("invalidates a token whose stamp is newer than the stored one", () => {
    expect(
      isSessionStale(at("2026-08-25T12:00:00Z").getTime(), at("2026-08-01T00:00:00Z"))
    ).toBe(true);
  });

  it("invalidates a stamped token when the stored value is cleared", () => {
    expect(isSessionStale(at("2026-08-25T12:00:00Z").getTime(), null)).toBe(true);
  });
});
