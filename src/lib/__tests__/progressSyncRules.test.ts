import { describe, expect, it } from "vitest";
import { jellyfinIsNewer, resumeSeconds } from "../progressSyncRules";

const t = (s: number) => new Date(Date.UTC(2026, 8, 30, 23, 0, s));

describe("resumeSeconds", () => {
  it("takes a newer rewind from Jellyfin over Streamy's larger, older position", () => {
    expect(resumeSeconds({ seconds: 510, updatedAt: t(0) }, { seconds: 493, played: false, lastPlayedAt: t(40) })).toBe(493);
  });
  it("keeps Streamy's newer position over Jellyfin's older one", () => {
    expect(resumeSeconds({ seconds: 300, updatedAt: t(50) }, { seconds: 900, played: false, lastPlayedAt: t(0) })).toBe(300);
  });
  it("treats near-simultaneous stamps as the same save", () => {
    expect(jellyfinIsNewer({ seconds: 1, updatedAt: t(10) }, { seconds: 1, played: false, lastPlayedAt: t(13) })).toBe(false);
  });
  it("restarts a title finished in Jellyfin more recently", () => {
    expect(resumeSeconds({ seconds: 700, updatedAt: t(0) }, { seconds: null, played: true, lastPlayedAt: t(30) })).toBe(0);
  });
  it("falls back to whichever side exists", () => {
    expect(resumeSeconds(null, { seconds: 120, played: false, lastPlayedAt: null })).toBe(120);
    expect(resumeSeconds({ seconds: 60, updatedAt: t(0) }, null)).toBe(60);
    expect(resumeSeconds(null, null)).toBe(0);
  });
});
