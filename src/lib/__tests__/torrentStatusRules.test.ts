import { describe, expect, it } from "vitest";
import { describeTransfer, withTorrentTransfer, type TorrentTransfer } from "../torrentStatusRules";

const base: TorrentTransfer = {
  progress: 0.4,
  dlSpeed: 2_500_000,
  etaSeconds: 3 * 3600 + 600,
  connectedSeeds: 12,
  swarmSeeds: 40,
  state: "downloading",
};

describe("describeTransfer", () => {
  it("says seeders, speed and time left", () => {
    expect(describeTransfer(base)).toBe("12 seeders · 2.5 MB/s · 3 h 10 min left");
  });

  it("says when no seeder is connected but the swarm has some", () => {
    expect(describeTransfer({ ...base, connectedSeeds: 0, dlSpeed: 0, state: "stalledDL" })).toBe(
      "No seeder connected (40 in the swarm)"
    );
  });

  it("says when the swarm has no seeders", () => {
    expect(describeTransfer({ ...base, connectedSeeds: 0, swarmSeeds: 0, dlSpeed: 0, state: "stalledDL" })).toBe(
      "No seeders right now"
    );
  });

  it("leaves out an unknown time left", () => {
    expect(describeTransfer({ ...base, connectedSeeds: 1, dlSpeed: 255_000, etaSeconds: 8_640_000 })).toBe(
      "1 seeder · 255 KB/s"
    );
  });

  it("names the states that are not transferring", () => {
    expect(describeTransfer({ ...base, state: "pausedDL" })).toBe("Paused");
    expect(describeTransfer({ ...base, state: "metaDL" })).toBe("Fetching torrent details from peers");
    expect(describeTransfer({ ...base, state: "queuedDL" })).toBe("Waiting its turn in qBittorrent");
  });

  it("is null once finished", () => {
    expect(describeTransfer({ ...base, progress: 1 })).toBeNull();
  });
});

describe("withTorrentTransfer", () => {
  const torrents = new Map([["abc123", base]]);

  it("adds the line to an in-flight torrent row, matching the hash in any case", () => {
    const [row] = withTorrentTransfer([{ downloadId: "ABC123", protocol: "torrent", transfer: null as string | null }], torrents);
    expect(row.transfer).toBe("12 seeders · 2.5 MB/s · 3 h 10 min left");
  });

  it("leaves usenet, importing, finished and unknown rows alone", () => {
    const rows = [
      { downloadId: "abc123", protocol: "usenet" },
      { downloadId: "abc123", protocol: "torrent", importing: true },
      { downloadId: "abc123", protocol: "torrent", completed: true },
      { downloadId: "other", protocol: "torrent" },
    ];
    expect(withTorrentTransfer(rows, torrents).map((r) => (r as { transfer?: string }).transfer)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
