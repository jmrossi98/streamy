import { describe, it, expect } from "vitest";
import { isPermanentlyBlocked, pickIdleEpisodeBatch, isUnhealthy, shouldBlocklist, shouldBlocklistStalled, STALL_BLOCKLIST_AFTER, UNSAFE_REASONS, type DownloadHealth } from "../downloadHealthRules";

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

describe("permanent blocks from an admin cancel", () => {
  // The real release, verbatim from the queue: brackets, a star, mixed
  // languages. Sonarr's blocklist reports it as sourceTitle, we record it as
  // releaseTitle, and the two have to be recognised as the same thing or the
  // six-hour expiry lets it back in.
  const gurren =
    "[Sadame no Fansub] Sfondamento dei cieli Gurren Lagann - Kirameki★Yoko Box - Pieces of Sweet Stars[1080p][OGG][Sub ITA] (Softsub)";

  it("keeps an admin-cancelled release blocked past the TTL", () => {
    expect(
      isPermanentlyBlocked(
        { sourceTitle: gurren, torrentInfoHash: null },
        [{ releaseTitle: gurren, downloadId: null }]
      )
    ).toBe(true);
  });

  it("matches on the info hash even if the name is reported differently", () => {
    expect(
      isPermanentlyBlocked(
        { sourceTitle: "something else entirely", torrentInfoHash: "ABC123" },
        [{ releaseTitle: gurren, downloadId: "abc123" }]
      )
    ).toBe(true);
  });

  it("does not block a different release of the same show", () => {
    expect(
      isPermanentlyBlocked(
        { sourceTitle: "Gurren Lagann S01E01 1080p BluRay x265-GRP", torrentInfoHash: null },
        [{ releaseTitle: gurren, downloadId: null }]
      )
    ).toBe(false);
  });

  it("treats an admin cancel as not-unsafe", () => {
    // The viewer-facing notice says "rejected as unsafe"; a deliberate cancel
    // is not that, and must not inflate that count or the re-search cap.
    expect([...UNSAFE_REASONS]).toEqual(["executable"]);
    expect([...UNSAFE_REASONS]).not.toContain("cancelledByAdmin");
  });
});

describe("shouldBlocklistStalled", () => {
  it("does not blame the release for a first stall", () => {
    // One stall is usually conditions -- a VPN reconnect, a peer drought --
    // and blocklisting for that poisons well-seeded releases.
    expect(shouldBlocklistStalled("The download is stalled with no connections", 1)).toBe(false);
  });

  it("blames the release once the same episode keeps stalling", () => {
    // The loop this exists for: cancelling without blocklisting leaves the
    // release top-scoring, so the next search picks it straight back up. The
    // Wire S01E12 was grabbed five times in minutes.
    expect(shouldBlocklistStalled("The download is stalled with no connections", 2)).toBe(true);
    expect(shouldBlocklistStalled("stalled", STALL_BLOCKLIST_AFTER + 3)).toBe(true);
  });

  it("still blocklists a failed payload on the first go", () => {
    // Nothing transient about a client refusing the download.
    expect(shouldBlocklistStalled("The download client failed to import", 1)).toBe(
      shouldBlocklist("The download client failed to import")
    );
  });

  it("treats a missing message the same as shouldBlocklist does", () => {
    expect(shouldBlocklistStalled(null, 1)).toBe(shouldBlocklist(null));
  });
});

describe("pickIdleEpisodeBatch", () => {
  const eps = [1, 2, 3, 4, 5, 6, 7].map((episodeId) => ({ episodeId }));
  const tries: Record<number, number> = { 1: 4, 2: 0, 3: 1, 4: 0, 5: 2, 6: 0, 7: 0 };

  it("caps the batch and prefers the least-tried, keeping list order among ties", () => {
    const got = pickIdleEpisodeBatch(eps, (e) => tries[e.episodeId], () => false, 5);
    expect(got.map((e) => e.episodeId)).toEqual([2, 4, 6, 7, 3]);
  });

  it("skips episodes on cooldown", () => {
    const got = pickIdleEpisodeBatch(eps, (e) => tries[e.episodeId], (e) => e.episodeId % 2 === 0, 5);
    expect(got.map((e) => e.episodeId)).toEqual([7, 3, 5, 1]);
  });
});
