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
  expireSonarrBlocklist: vi.fn(),
  recordRejection: vi.fn(),
  getPermanentBlocks: vi.fn(),
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
  expireSonarrBlocklist: m.expireSonarrBlocklist,
}));
vi.mock("../rejectedReleases", () => ({
  recordRejection: m.recordRejection,
  getPermanentBlocks: m.getPermanentBlocks,
  countRecentRejections: m.countRecentRejections,
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
  m.getPermanentBlocks.mockResolvedValue([]);
  m.countRecentRejections.mockResolvedValue(1);
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

    expect(m.cancelSonarrQueueItem).toHaveBeenCalledWith(77, { blocklist: true });
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

  it("skips the expiry entirely when the rejected list can't be read", async () => {
    // Expiring blind would un-block the fake.
    m.getPermanentBlocks.mockRejectedValue(new Error("database is locked"));

    await healStalledDownloads();

    expect(m.expireRadarrBlocklist).not.toHaveBeenCalled();
    expect(m.expireSonarrBlocklist).not.toHaveBeenCalled();
  });
});
