import { describe, it, expect } from "vitest";
import { stalledDownloads, type TorrentHealth } from "../qbittorrent";

function t(over: Partial<TorrentHealth> = {}): TorrentHealth {
  return {
    name: "Something.1986.1080p",
    state: "downloading",
    progress: 0.5,
    connectedSeeds: 5,
    swarmSeeds: 20,
    dlSpeed: 500_000,
    ...over,
  };
}

describe("stalledDownloads", () => {
  it("ignores a download that is actually moving", () => {
    expect(stalledDownloads([t()])).toEqual([]);
  });

  // qBittorrent's own word for "no usable peers".
  it("flags an explicitly stalled download", () => {
    expect(stalledDownloads([t({ state: "stalledDL", dlSpeed: 0 })])).toHaveLength(1);
  });

  // The real case: state says downloading, speed is zero, and Radarr happily
  // reports it as in progress until its own timeout hours later.
  it("flags a download that claims to be running at zero bytes per second", () => {
    expect(stalledDownloads([t({ state: "downloading", dlSpeed: 0 })])).toHaveLength(1);
  });

  // A finished torrent seeding to nobody is the normal resting state, not a
  // problem, and must not light the panel up red forever.
  it("ignores completed torrents with no peers", () => {
    const done = [
      t({ progress: 1, state: "stalledUP", dlSpeed: 0, connectedSeeds: 0 }),
      t({ progress: 1, state: "stoppedUP", dlSpeed: 0, connectedSeeds: 0 }),
    ];
    expect(stalledDownloads(done)).toEqual([]);
  });

  it("returns every stalled download, not just the first", () => {
    const list = [t({ state: "stalledDL", dlSpeed: 0 }), t(), t({ dlSpeed: 0 })];
    expect(stalledDownloads(list)).toHaveLength(2);
  });
});
