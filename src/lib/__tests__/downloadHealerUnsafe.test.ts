import { describe, it, expect, vi, beforeEach } from "vitest";

// The healer is the part that touches real Radarr/Sonarr/qBittorrent and the
// database, so its clients are mocked and the test pins down what it does with
// them: the order, and the arguments that decide whether a fake can come back.
const calls: string[] = [];
const m = vi.hoisted(() => ({
  getRadarrQueueHealth: vi.fn(),
  getIdleWantedMovies: vi.fn(),
  cancelRadarrDownload: vi.fn(),
  cancelRadarrQueueItem: vi.fn(),
  searchRadarrMovie: vi.fn(),
  expireRadarrBlocklist: vi.fn(),
  getSonarrQueueHealth: vi.fn(),
  getIdleWantedEpisodes: vi.fn(),
  searchSonarrEpisodes: vi.fn(),
  cancelSonarrDownload: vi.fn(),
  cancelSonarrQueueItem: vi.fn(),
  searchSonarrSeries: vi.fn(),
  deepSearchSonarrSeason: vi.fn(async () => null),
  deepSearchSonarrEpisode: vi.fn(async () => null),
  getReplacements: vi.fn(),
  recordReplacement: vi.fn(),
  expireSonarrBlocklist: vi.fn(),
  outstandingSearches: vi.fn(),
  recordRejection: vi.fn(),
  getPermanentBlocks: vi.fn(),
  getCancelBlocks: vi.fn(),
  forgetCancelBlocks: vi.fn(),
  countRecentRejections: vi.fn(),
}));

vi.mock("../radarr", () => ({
  getRadarrQueueHealth: m.getRadarrQueueHealth,
  getIdleWantedMovies: m.getIdleWantedMovies,
  cancelRadarrDownload: m.cancelRadarrDownload,
  cancelRadarrQueueItem: m.cancelRadarrQueueItem,
  searchRadarrMovie: m.searchRadarrMovie,
  expireRadarrBlocklist: m.expireRadarrBlocklist,
}));
vi.mock("../sonarr", () => ({
  getSonarrQueueHealth: m.getSonarrQueueHealth,
  getIdleWantedEpisodes: m.getIdleWantedEpisodes,
  searchSonarrEpisodes: m.searchSonarrEpisodes,
  cancelSonarrDownload: m.cancelSonarrDownload,
  cancelSonarrQueueItem: m.cancelSonarrQueueItem,
  searchSonarrSeries: m.searchSonarrSeries,
  deepSearchSonarrSeason: m.deepSearchSonarrSeason,
  deepSearchSonarrEpisode: m.deepSearchSonarrEpisode,
  expireSonarrBlocklist: m.expireSonarrBlocklist,
  outstandingSearches: m.outstandingSearches,
}));
// Mocked for the same reason as the clients above: this file tests heal
// policy, and the real module reaches the database, which the unit tests do
// not have (CI installs with --ignore-scripts).
vi.mock("../pendingEpisodeSearch", () => ({
  pendingSearchIds: vi.fn(async () => [] as number[]),
  pendingSearchStats: vi.fn(async () => ({ total: 0, oldestWaitMinutes: 0, series: 0, retrying: 0 })),
}));

vi.mock("../rejectedReleases", () => ({
  recordRejection: m.recordRejection,
  getPermanentBlocks: m.getPermanentBlocks,
  getCancelBlocks: m.getCancelBlocks,
  forgetCancelBlocks: m.forgetCancelBlocks,
  countRecentRejections: m.countRecentRejections,
  getReplacements: m.getReplacements,
  recordReplacement: m.recordReplacement,
}));

import { healStalledDownloads } from "../downloadHealer";

const TITLE = "Resident Evil (2026) 1080p AMZN WEB-DL DDP5 1 H 264-FLUX.exe";
const HASH = "223913A3A93C74852B3949D46375DD237332B2E7";

function unsafeEntry(over: object = {}) {
  return {
    queueId: 684736251,
    externalId: 38,
    downloadId: HASH,
    title: TITLE,
    errorMessage: null,
    ageMinutes: 45,
    hasProgress: true,
    unsafe: "executable",
    ...over,
  };
}

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  m.getRadarrQueueHealth.mockResolvedValue([]);
  m.getSonarrQueueHealth.mockResolvedValue([]);
  m.getIdleWantedMovies.mockResolvedValue([]);
  m.getIdleWantedEpisodes.mockResolvedValue([]);
  m.expireRadarrBlocklist.mockResolvedValue(0);
  m.expireSonarrBlocklist.mockResolvedValue(0);
  m.outstandingSearches.mockResolvedValue(0);
  m.getPermanentBlocks.mockResolvedValue([]);
  m.getCancelBlocks.mockResolvedValue([]);
  m.forgetCancelBlocks.mockResolvedValue(undefined);
  m.countRecentRejections.mockResolvedValue(1);
  m.getReplacements.mockResolvedValue([]);
  m.recordReplacement.mockResolvedValue(undefined);
  m.cancelRadarrQueueItem.mockImplementation(async () => (calls.push("remove"), true));
  m.cancelSonarrQueueItem.mockImplementation(async () => (calls.push("remove"), true));
  m.recordRejection.mockImplementation(async () => void calls.push("record"));
  m.searchRadarrMovie.mockImplementation(async () => void calls.push("search"));
  m.searchSonarrEpisodes.mockImplementation(async () => void calls.push("search"));
  m.searchSonarrSeries.mockImplementation(async () => void calls.push("search"));
});

describe("healStalledDownloads: unsafe releases", () => {
  it("records, removes with a permanent blocklist, then searches for the next release", async () => {
    m.getRadarrQueueHealth.mockResolvedValue([unsafeEntry()]);

    const healed = await healStalledDownloads();

    // Recorded first: that record is what keeps the blocklist entry from expiring.
    expect(calls).toEqual(["record", "remove", "search"]);
    expect(m.recordRejection).toHaveBeenCalledWith({
      mediaType: "movie",
      externalId: 38,
      releaseTitle: TITLE,
      downloadId: HASH,
      reason: "executable",
    });
    expect(m.cancelRadarrQueueItem).toHaveBeenCalledWith(684736251, { blocklist: true });
    expect(m.searchRadarrMovie).toHaveBeenCalledWith(38);
    expect(healed).toEqual([{ title: TITLE, reason: "unsafe release removed (executable)" }]);
  });

  it("does not also run the stall path, which re-grabs without blocklisting", async () => {
    // Old enough with an error message would otherwise qualify as unhealthy.
    m.getRadarrQueueHealth.mockResolvedValue([unsafeEntry({ errorMessage: "warning", ageMinutes: 90 })]);

    await healStalledDownloads();

    expect(m.cancelRadarrDownload).not.toHaveBeenCalled();
    expect(m.searchRadarrMovie).toHaveBeenCalledTimes(1);
  });

  it("does not search for a replacement when removal failed, so the next scan retries cleanly", async () => {
    m.getRadarrQueueHealth.mockResolvedValue([unsafeEntry()]);
    m.cancelRadarrQueueItem.mockResolvedValue(false);

    const healed = await healStalledDownloads();

    expect(m.searchRadarrMovie).not.toHaveBeenCalled();
    expect(healed).toEqual([]);
  });

  it("still removes the file when the rejection can't be recorded", async () => {
    // Getting the payload off the disk matters more than the bookkeeping.
    m.getRadarrQueueHealth.mockResolvedValue([unsafeEntry()]);
    m.recordRejection.mockRejectedValue(new Error("database is locked"));

    const healed = await healStalledDownloads();

    expect(m.cancelRadarrQueueItem).toHaveBeenCalledWith(684736251, { blocklist: true });
    expect(healed).toHaveLength(1);
  });

  it("stops chaining immediate searches once a title keeps producing fakes", async () => {
    m.getRadarrQueueHealth.mockResolvedValue([unsafeEntry()]);
    m.countRecentRejections.mockResolvedValue(6);

    const healed = await healStalledDownloads();

    // Still removed and blocklisted -- only the back-to-back search is held off.
    expect(m.cancelRadarrQueueItem).toHaveBeenCalled();
    expect(m.searchRadarrMovie).not.toHaveBeenCalled();
    expect(healed).toHaveLength(1);
  });

  it("scopes a Sonarr rejection to that queue entry and episode, not the whole series", async () => {
    m.getSonarrQueueHealth.mockResolvedValue([
      unsafeEntry({ queueId: 77, externalId: 12, episodeId: 901, title: "Show S01E01 1080p.exe" }),
    ]);

    await healStalledDownloads();

    expect(m.cancelSonarrQueueItem).toHaveBeenCalledWith(77, { blocklist: true, keepWanted: true });
    expect(m.cancelSonarrDownload).not.toHaveBeenCalled();
    expect(m.searchSonarrEpisodes).toHaveBeenCalledWith([901]);
    expect(m.recordRejection).toHaveBeenCalledWith(
      expect.objectContaining({ mediaType: "show", externalId: 12 })
    );
  });

  it("leaves an ordinary finished download alone", async () => {
    m.getRadarrQueueHealth.mockResolvedValue([unsafeEntry({ unsafe: null })]);

    const healed = await healStalledDownloads();

    expect(m.recordRejection).not.toHaveBeenCalled();
    expect(m.cancelRadarrQueueItem).not.toHaveBeenCalled();
    expect(healed).toEqual([]);
  });
});

describe("healStalledDownloads: blocklist expiry", () => {
  it("hands the expiry a predicate that keeps rejected releases", async () => {
    m.getPermanentBlocks.mockResolvedValue([{ releaseTitle: TITLE, downloadId: HASH }]);

    await healStalledDownloads();

    const keep = m.expireRadarrBlocklist.mock.calls[0][1] as (r: object) => boolean;
    expect(keep({ sourceTitle: "Resident Evil (2026) 1080p AMZN WEB DL DDP5 1 H 264 FLUX" })).toBe(true);
    expect(keep({ sourceTitle: "Grizzly Man 2005 1080p BluRay" })).toBe(false);
    // Sonarr gets the same protection.
    expect(m.expireSonarrBlocklist.mock.calls[0][1]).toBe(m.expireRadarrBlocklist.mock.calls[0][1]);
  });

  it("releases cancel-blocked releases at once, then forgets them", async () => {
    // Blocked only because an admin once cancelled it: never a bad release.
    m.getCancelBlocks.mockResolvedValue([{ id: 7, releaseTitle: "Grizzly Man 2005 1080p BluRay", downloadId: null }]);

    await healStalledDownloads();

    const releaseNow = m.expireSonarrBlocklist.mock.calls[0][2] as (r: object) => boolean;
    expect(releaseNow({ sourceTitle: "Grizzly Man 2005 1080p BluRay" })).toBe(true);
    expect(releaseNow({ sourceTitle: "Something Else 2020 1080p" })).toBe(false);
    expect(m.forgetCancelBlocks).toHaveBeenCalledWith([7]);
  });

  it("skips the expiry entirely when the rejected list can't be read", async () => {
    // Expiring blind would un-block the fake.
    m.getPermanentBlocks.mockRejectedValue(new Error("database is locked"));

    await healStalledDownloads();

    expect(m.expireRadarrBlocklist).not.toHaveBeenCalled();
    expect(m.expireSonarrBlocklist).not.toHaveBeenCalled();
  });
});

describe("healStalledDownloads: idle episode re-search", () => {
  const idle = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({ episodeId: from + i, title: `Ep ${from + i}` }));

  it("adds nothing while a search is already running, so a fresh request is not queued behind it", async () => {
    m.outstandingSearches.mockResolvedValue(1);
    m.getIdleWantedEpisodes.mockResolvedValue(idle(9000, 3));
    await healStalledDownloads();
    expect(m.searchSonarrEpisodes).not.toHaveBeenCalled();
  });

  it("treats an unreadable command queue as busy", async () => {
    m.outstandingSearches.mockResolvedValue(null);
    m.getIdleWantedEpisodes.mockResolvedValue(idle(9100, 3));
    await healStalledDownloads();
    expect(m.searchSonarrEpisodes).not.toHaveBeenCalled();
  });

  it("re-searches a small batch rather than everything at once", async () => {
    m.getIdleWantedEpisodes.mockResolvedValue(idle(9200, 28));
    await healStalledDownloads();
    expect(m.searchSonarrEpisodes).toHaveBeenCalledTimes(1);
    expect(m.searchSonarrEpisodes.mock.calls[0][0]).toEqual([9200, 9201, 9202, 9203, 9204]);
  });
});

describe("healStalledDownloads: waiting and stuck imports", () => {
  const queued = (over: object = {}) => ({
    queueId: 5100,
    externalId: 19,
    episodeId: 1551,
    downloadId: "SABnzbd_nzo_x",
    title: "The.Sopranos.S05E10.1080p.BluRay",
    errorMessage: null,
    ageMinutes: 40,
    hasProgress: false,
    unsafe: null,
    clientStatus: "queued",
    trackedDownloadState: "downloading",
    trackedDownloadStatus: "ok",
    importProblem: null,
    statusMessages: [] as string[],
    protocol: "usenet",
    ...over,
  });

  it("leaves a job waiting its turn in the download client alone", async () => {
    m.getSonarrQueueHealth.mockResolvedValue([queued()]);
    await healStalledDownloads();
    expect(m.cancelSonarrQueueItem).not.toHaveBeenCalled();
  });

  it("leaves a usenet job at 0% alone even when the client calls it downloading", async () => {
    // SABnzbd reports every job in its queue that way, not only the active one.
    m.getSonarrQueueHealth.mockResolvedValue([queued({ queueId: 5103, episodeId: 1553, clientStatus: "downloading" })]);
    await healStalledDownloads();
    expect(m.cancelSonarrQueueItem).not.toHaveBeenCalled();
  });

  it("still re-grabs a started torrent that has made no progress, keeping the episode wanted", async () => {
    m.getSonarrQueueHealth.mockResolvedValue([
      queued({ queueId: 5101, episodeId: 1552, clientStatus: "downloading", protocol: "torrent", downloadId: "ABC123" }),
    ]);
    await healStalledDownloads();
    // Blocklisted, so the search that follows cannot hand the same one back.
    expect(m.cancelSonarrQueueItem).toHaveBeenCalledWith(5101, { blocklist: true, keepWanted: true });
    expect(m.recordReplacement).toHaveBeenCalledWith(
      expect.objectContaining({ mediaType: "episode", externalId: 1552, downloadId: "ABC123" })
    );
    expect(m.searchSonarrEpisodes).toHaveBeenCalledWith([1552]);
  });

  it("removes a finished download the library already has a better copy of, without blocklisting or searching", async () => {
    const surplus = {
      ...queued({
        queueId: 5104,
        hasProgress: true,
        clientStatus: "completed",
        trackedDownloadState: "importPending",
        trackedDownloadStatus: "warning",
        statusMessages: [
          "Not an upgrade for existing movie file. Existing quality: Bluray-2160p. New Quality Bluray-1080p.",
        ],
      }),
      episodeId: undefined,
    };
    m.getRadarrQueueHealth.mockResolvedValue([surplus]);
    const healed = await healStalledDownloads();
    expect(m.cancelRadarrQueueItem).toHaveBeenCalledWith(5104, { blocklist: false });
    expect(m.searchRadarrMovie).not.toHaveBeenCalled();
    expect(healed.some((h) => h.reason.includes("not needed"))).toBe(true);
  });

  it("replaces a finished download that cannot import, but only after it has stayed stuck", async () => {
    vi.useFakeTimers();
    try {
      const stuck = queued({
        queueId: 5102,
        episodeId: 1540,
        hasProgress: true,
        clientStatus: "completed",
        trackedDownloadState: "importPending",
        trackedDownloadStatus: "warning",
        importProblem: "Unable to determine if file is a sample",
      });
      m.getSonarrQueueHealth.mockResolvedValue([stuck]);
      vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
      await healStalledDownloads();
      expect(m.cancelSonarrQueueItem).not.toHaveBeenCalled();

      vi.setSystemTime(new Date("2026-09-28T12:31:00Z"));
      const healed = await healStalledDownloads();
      expect(m.cancelSonarrQueueItem).toHaveBeenCalledWith(5102, { blocklist: true, keepWanted: true });
      expect(m.searchSonarrEpisodes).toHaveBeenCalledWith([1540]);
      expect(healed.some((h) => h.reason.includes("could not import"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("healStalledDownloads: no loops", () => {
  const stalledMovie = (over: object = {}) => ({
    queueId: 7001,
    externalId: 85,
    downloadId: "489B73E195CB6EF8E013E452812DA5891715C275",
    title: "Dances.with.Wolves.1990.DC.Kevin.Costner.2160p.HDR.DTS.mkv",
    errorMessage: "The download is stalled with no connections",
    ageMinutes: 90,
    hasProgress: true,
    unsafe: null,
    clientStatus: "warning",
    trackedDownloadState: "downloading",
    trackedDownloadStatus: "warning",
    importProblem: null,
    statusMessages: [] as string[],
    protocol: "torrent",
    isUpgrade: true,
    ...over,
  });
  // A different movie per test: the healer keeps a per-title cooldown.
  const dropped = (n: number, externalId: number) =>
    Array.from({ length: n }, (_, i) => ({
      mediaType: "movie",
      externalId,
      releaseTitle: `release ${i}`,
      downloadId: `hash${i}`,
      createdAt: new Date(),
    }));

  it("blocklists a stalled release on its first drop, so it cannot be re-grabbed from zero", async () => {
    // Regression, 2026-10-04: dropped without blocklisting, the same torrent
    // was picked again and restarted -- 52%, then 3%, then 0%.
    m.getRadarrQueueHealth.mockResolvedValue([stalledMovie()]);
    await healStalledDownloads();
    expect(m.cancelRadarrQueueItem).toHaveBeenCalledWith(7001, { blocklist: true });
    expect(m.recordReplacement).toHaveBeenCalledWith(expect.objectContaining({ mediaType: "movie", externalId: 85 }));
    expect(m.searchRadarrMovie).toHaveBeenCalledWith(85);
  });

  it("past the daily limit, leaves a stalled download in place rather than fetching another", async () => {
    m.getReplacements.mockResolvedValue(dropped(4, 86));
    m.getRadarrQueueHealth.mockResolvedValue([stalledMovie({ externalId: 86, queueId: 7002 })]);
    await healStalledDownloads();
    expect(m.cancelRadarrQueueItem).not.toHaveBeenCalled();
    expect(m.searchRadarrMovie).not.toHaveBeenCalled();
    // One release short of the limit, the same download is replaced.
    m.getReplacements.mockResolvedValue(dropped(3, 88));
    m.getRadarrQueueHealth.mockResolvedValue([stalledMovie({ externalId: 88, queueId: 7004 })]);
    await healStalledDownloads();
    expect(m.cancelRadarrQueueItem).toHaveBeenCalledWith(7004, { blocklist: true });
  });

  it("past the daily limit, clears a failed download but starts no new search", async () => {
    m.getReplacements.mockResolvedValue(dropped(4, 87));
    m.getRadarrQueueHealth.mockResolvedValue([
      stalledMovie({ externalId: 87, queueId: 7003, errorMessage: "qBittorrent is reporting an error", hasProgress: false }),
    ]);
    await healStalledDownloads();
    expect(m.cancelRadarrQueueItem).toHaveBeenCalledWith(7003, { blocklist: true });
    expect(m.searchRadarrMovie).not.toHaveBeenCalled();
  });

  it("keeps a release dropped twice this week out of the blocklist expiry", async () => {
    const twice = [
      { mediaType: "movie", externalId: 85, releaseTitle: "Dead.Release.2160p", downloadId: "AAA", createdAt: new Date() },
      { mediaType: "movie", externalId: 85, releaseTitle: "Dead.Release.2160p", downloadId: "AAA", createdAt: new Date() },
    ];
    m.getReplacements.mockResolvedValue(twice);
    await healStalledDownloads();
    const keep = m.expireRadarrBlocklist.mock.calls[0][1] as (r: object) => boolean;
    expect(keep({ sourceTitle: "Dead Release 2160p", torrentInfoHash: "aaa" })).toBe(true);
    expect(keep({ sourceTitle: "Some.Other.Release", torrentInfoHash: "bbb" })).toBe(false);
  });
});
