import { describe, expect, it } from "vitest";
import { driveFullness } from "../storageDriveRules";

const TB = 1e12;

describe("driveFullness", () => {
  it("is quiet below 85%", () => {
    // The old drive on 2026-11-13, before any shows moved: 82%.
    expect(driveFullness(7.94 * TB, 1.47 * TB)).toEqual({ usedPct: 81, state: "ok" });
    expect(driveFullness(8 * TB, 8 * TB)).toEqual({ usedPct: 0, state: "ok" });
  });

  it("says filling from 85% and full from 90%", () => {
    expect(driveFullness(8 * TB, 1.2 * TB).state).toBe("filling");
    expect(driveFullness(8 * TB, 0.8 * TB).state).toBe("full");
    expect(driveFullness(8 * TB, 0).state).toBe("full");
  });

  it("treats an unknown size as nothing to say", () => {
    expect(driveFullness(0, 0)).toEqual({ usedPct: 0, state: "ok" });
  });
});
