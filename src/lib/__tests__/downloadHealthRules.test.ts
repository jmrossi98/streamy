import { describe, it, expect } from "vitest";
import { isRedundantImport, isDeadSwarm, isMetadataDead, isImportStuck, isPermanentlyBlocked, pickIdleEpisodeBatch, isUnhealthy, shouldBlocklist, shouldBlocklistStalled, STALL_BLOCKLIST_AFTER, UNSAFE_REASONS, type DownloadHealth } from "../downloadHealthRules";

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

describe("waiting and stuck-import rules", () => {
  it("never calls a queued, paused or delayed entry unhealthy", () => {
    for (const clientStatus of ["queued", "Paused", "delay"]) {
      expect(isUnhealthy({ errorMessage: null, ageMinutes: 300, hasProgress: false, clientStatus })).toBe(false);
    }
    expect(isUnhealthy({ errorMessage: null, ageMinutes: 300, hasProgress: false, clientStatus: "downloading" })).toBe(true);
  });

  it("flags only a completed download whose import is failing", () => {
    const base = { clientStatus: "completed", trackedDownloadState: "importPending", trackedDownloadStatus: "warning" };
    expect(isImportStuck(base)).toBe(true);
    expect(isImportStuck({ ...base, trackedDownloadStatus: "ok" })).toBe(false);
    expect(isImportStuck({ ...base, trackedDownloadState: "importing" })).toBe(false);
    expect(isImportStuck({ ...base, clientStatus: "downloading" })).toBe(false);
  });
});

describe("dead swarms", () => {
  it("blocklists a stalled torrent with no seeder anywhere on its first stall", () => {
    expect(shouldBlocklistStalled("The download is stalled with no connections", 1, true)).toBe(true);
    expect(shouldBlocklistStalled("The download is stalled with no connections", 1, false)).toBe(false);
  });

  it("calls a swarm dead only when no seeder is connected or known", () => {
    expect(isDeadSwarm({ swarmSeeds: 0, connectedSeeds: 0 })).toBe(true);
    expect(isDeadSwarm({ swarmSeeds: 3, connectedSeeds: 0 })).toBe(false);
    expect(isDeadSwarm({ swarmSeeds: 0, connectedSeeds: 1 })).toBe(false);
    expect(isDeadSwarm(undefined)).toBe(false);
  });
});

describe("torrent metadata and waiting states", () => {
  it("does not treat a torrent stuck fetching metadata as waiting its turn", () => {
    const e = { errorMessage: null, ageMinutes: 50, hasProgress: false, clientStatus: "queued", torrentState: "metaDL" };
    expect(isUnhealthy(e)).toBe(true);
    expect(isMetadataDead(e)).toBe(true);
  });

  it("gives metadata ten minutes, ahead of the general stall grace", () => {
    expect(isMetadataDead({ torrentState: "metaDL", ageMinutes: 9 })).toBe(false);
    expect(isUnhealthy({ errorMessage: null, ageMinutes: 10, hasProgress: false, clientStatus: "queued", torrentState: "metaDL" })).toBe(true);
  });

  it("still leaves a torrent genuinely queued in qBittorrent alone", () => {
    expect(isUnhealthy({ errorMessage: null, ageMinutes: 60, hasProgress: false, clientStatus: "queued", torrentState: "queuedDL" })).toBe(false);
  });
});

describe("usenet jobs waiting in the SABnzbd queue", () => {
  // Regression, 2026-10-04: SABnzbd reports every queued job as "downloading",
  // so a job at 0% behind 40 GB of others looked stalled and was cancelled,
  // re-grabbed to the back of the queue, then blocklisted.
  it("leaves a usenet job at 0% alone however long it has waited", () => {
    expect(
      isUnhealthy(entry({ protocol: "usenet", clientStatus: "downloading", ageMinutes: 90, hasProgress: false }))
    ).toBe(false);
  });

  it("still heals a usenet job that reports an error", () => {
    expect(
      isUnhealthy(
        entry({ protocol: "usenet", ageMinutes: 20, hasProgress: false, errorMessage: "Aborted, cannot be completed" })
      )
    ).toBe(true);
  });

  it("still heals a torrent that has never moved", () => {
    expect(
      isUnhealthy(entry({ protocol: "torrent", clientStatus: "downloading", ageMinutes: 20, hasProgress: false }))
    ).toBe(true);
  });
});

describe("isRedundantImport", () => {
  const notAnUpgrade =
    "Not an upgrade for existing movie file. Existing quality: Bluray-2160p. New Quality Bluray-1080p.";

  it("recognises a finished download the library already has a better copy of", () => {
    expect(isRedundantImport({ clientStatus: "completed", statusMessages: [notAnUpgrade] })).toBe(true);
    expect(
      isRedundantImport({
        clientStatus: "completed",
        statusMessages: ["Not a Custom Format upgrade for existing movie file(s)"],
      })
    ).toBe(true);
  });

  it("does not claim a download with any other import problem", () => {
    expect(
      isRedundantImport({
        clientStatus: "completed",
        statusMessages: [notAnUpgrade, "Unable to determine if file is a sample"],
      })
    ).toBe(false);
    expect(isRedundantImport({ clientStatus: "completed", statusMessages: [] })).toBe(false);
  });

  it("does not claim one that is still downloading", () => {
    expect(isRedundantImport({ clientStatus: "downloading", statusMessages: [notAnUpgrade] })).toBe(false);
  });
});
