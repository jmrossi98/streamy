import { describe, it, expect } from "vitest";
import { isUnhealthy, shouldBlocklist, type DownloadHealth } from "../downloadHealthRules";

function entry(overrides: Partial<DownloadHealth> = {}): DownloadHealth {
  return {
    errorMessage: null,
    ageMinutes: 60,
    hasProgress: true,
    ...overrides,
  };
}

describe("isUnhealthy", () => {
  it("leaves a young download alone even with no progress yet", () => {
    // Torrents take a little while to find peers; killing one that was about
    // to start is worse than waiting.
    expect(isUnhealthy(entry({ ageMinutes: 2, hasProgress: false }))).toBe(false);
  });

  it("leaves a young download alone even when it reports an error", () => {
    expect(
      isUnhealthy(entry({ ageMinutes: 1, errorMessage: "stalled with no connections" }))
    ).toBe(false);
  });

  it("flags an old download that has never moved a byte", () => {
    expect(isUnhealthy(entry({ ageMinutes: 60, hasProgress: false }))).toBe(true);
  });

  it("flags an old download reporting an error", () => {
    expect(
      isUnhealthy(entry({ ageMinutes: 60, errorMessage: "qBittorrent is reporting an error" }))
    ).toBe(true);
  });

  it("leaves a healthy, progressing download alone", () => {
    expect(isUnhealthy(entry({ ageMinutes: 600, hasProgress: true }))).toBe(false);
  });
});

describe("shouldBlocklist", () => {
  // Regression: blocklisting stalls poisoned the healthiest releases --
  // Severance S01E01's 104-seeder release was blocked while a 12-seeder one
  // downloaded. Only genuine failures should be permanently blocked.
  it("does not blocklist a plain stall", () => {
    expect(shouldBlocklist("The download is stalled with no connections")).toBe(false);
  });

  it("does not blocklist when there is no error at all", () => {
    expect(shouldBlocklist(null)).toBe(false);
  });

  it("blocklists a client-reported error", () => {
    expect(shouldBlocklist("qBittorrent is reporting an error")).toBe(true);
  });

  it("blocklists an outright failure", () => {
    expect(shouldBlocklist("Download failed")).toBe(true);
  });
});
