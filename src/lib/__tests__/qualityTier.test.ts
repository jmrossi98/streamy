import { describe, expect, it } from "vitest";
import { resolveQualityProfileId, tierForUser } from "../qualityTier";

describe("tierForUser", () => {
  it("gives admins 4K and everyone else 1080p", () => {
    expect(tierForUser(true)).toBe("uhd");
    expect(tierForUser(false)).toBe("hd");
  });
});

describe("resolveQualityProfileId", () => {
  it("sends non-admins to the HD profile", () => {
    expect(resolveQualityProfileId("hd", "4", "7")).toBe(4);
  });

  it("sends admins to the 4K profile", () => {
    expect(resolveQualityProfileId("uhd", "4", "7")).toBe(7);
  });

  /**
   * This is the behaviour on the day it ships: the 4K env vars are not set
   * anywhere yet, so admins must keep getting 1080p rather than having their
   * requests fail. Deploying this should change nothing until someone
   * configures the profile deliberately.
   */
  it("falls back to HD when no 4K profile is configured", () => {
    expect(resolveQualityProfileId("uhd", "4", undefined)).toBe(4);
    expect(resolveQualityProfileId("uhd", "4", "")).toBe(4);
  });

  it("treats junk and zero as unconfigured rather than as a profile id", () => {
    // Radarr profile ids are positive integers. Sending 0 or NaN would
    // either error or silently land on the wrong profile.
    expect(resolveQualityProfileId("uhd", "4", "0")).toBe(4);
    expect(resolveQualityProfileId("uhd", "4", "not-a-number")).toBe(4);
    expect(resolveQualityProfileId("hd", "0", undefined)).toBeNull();
  });

  it("returns null when nothing is configured at all", () => {
    // isRadarrConfigured already gates this, so null means "caller should
    // not have got here" rather than a value to send onward.
    expect(resolveQualityProfileId("hd", undefined, undefined)).toBeNull();
    expect(resolveQualityProfileId("uhd", undefined, undefined)).toBeNull();
  });

  it("never lets a non-admin reach the 4K profile", () => {
    // The whole point of the split. Pinned because a future refactor that
    // swapped the fallback order would be invisible until a bandwidth bill.
    for (const uhd of ["7", "5", undefined, "", "0"]) {
      expect(resolveQualityProfileId("hd", "4", uhd)).toBe(4);
    }
  });
});
