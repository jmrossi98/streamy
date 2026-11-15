import { describe, it, expect } from "vitest";
import { compactEpisode, parseEpisodeStore, serializeEpisodeStore, type StoredEpisode } from "../sonarrEpisodeStore";

const episode: StoredEpisode = {
  id: 7,
  seasonNumber: 1,
  episodeNumber: 2,
  title: "Stray Dog Strut",
  hasFile: true,
  monitored: true,
  airDateUtc: "1998-04-10T00:00:00Z",
  episodeFile: { relativePath: "Season 01/Cowboy Bebop - S01E02.mkv", size: 1_000, dateAdded: "2026-11-15T12:00:00Z" },
};

describe("the episode-list cache file", () => {
  it("keeps only the fields the panel reads", () => {
    const fromSonarr = {
      ...episode,
      overview: "a long synopsis",
      episodeFile: { ...episode.episodeFile, mediaInfo: { videoCodec: "x265" } },
    } as StoredEpisode;
    expect(compactEpisode(fromSonarr)).toEqual(episode);
    expect(compactEpisode({ ...episode, episodeFile: undefined }).episodeFile).toBeNull();
  });

  it("reads back what it wrote", () => {
    const store = {
      lists: new Map([[42, { signature: "1:1000:26:26", at: 123, episodes: [episode] }]]),
      protocols: new Map([[7, "usenet" as const], [8, "unknown" as const]]),
    };
    const back = parseEpisodeStore(serializeEpisodeStore(store));
    expect(back.lists.get(42)).toEqual(store.lists.get(42));
    expect([...back.protocols]).toEqual([...store.protocols]);
  });

  it("ignores a file it cannot trust, whole or in part", () => {
    expect(parseEpisodeStore("{not json").lists.size).toBe(0);
    expect(parseEpisodeStore(JSON.stringify({ format: 0, lists: { 1: {} } })).lists.size).toBe(0);
    const mixed = parseEpisodeStore(
      JSON.stringify({
        format: 1,
        lists: {
          1: { signature: "s", at: 1, episodes: [episode] },
          2: { signature: "s", at: 1, episodes: [{ id: "x" }] },
          3: { signature: "s", at: 1, episodes: [] },
          four: { signature: "s", at: 1, episodes: [episode] },
        },
        protocols: { 7: "torrent", 8: "carrier pigeon" },
      })
    );
    expect([...mixed.lists.keys()]).toEqual([1]);
    expect([...mixed.protocols]).toEqual([[7, "torrent"]]);
  });
});
