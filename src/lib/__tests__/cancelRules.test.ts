import { describe, expect, it } from "vitest";
import { episodeSearchesToCancel, movieSearchesToCancel, seriesSearchesToCancel } from "../cancelRules";

describe("seriesSearchesToCancel", () => {
  const commands = [
    { id: 1, name: "SeasonSearch", status: "started", body: { seriesId: 27 } },
    { id: 2, name: "EpisodeSearch", status: "queued", body: { episodeIds: [900, 901] } },
    { id: 3, name: "EpisodeSearch", status: "queued", body: { episodeIds: [5] } },
    { id: 4, name: "SeasonSearch", status: "completed", body: { seriesId: 27 } },
    { id: 5, name: "RefreshSeries", status: "started", body: { seriesId: 27 } },
    { id: 6, name: "SeriesSearch", status: "queued", body: { seriesId: 8 } },
  ];
  it("stops live searches for the series or any of its episodes, and nothing else", () => {
    expect(seriesSearchesToCancel(commands, 27, [900, 950])).toEqual([1, 2]);
  });
});

describe("movieSearchesToCancel", () => {
  it("stops a live search naming the movie", () => {
    const commands = [
      { id: 1, name: "MoviesSearch", status: "started", body: { movieIds: [3, 4] } },
      { id: 2, name: "MoviesSearch", status: "completed", body: { movieIds: [3] } },
      { id: 3, name: "MoviesSearch", status: "queued", body: { movieIds: [9] } },
    ];
    expect(movieSearchesToCancel(commands, 3)).toEqual([1]);
  });
});

describe("episodeSearchesToCancel", () => {
  const commands = [
    { id: 1, name: "SeasonSearch", status: "started", body: { seriesId: 27, seasonNumber: 2 } },
    { id: 2, name: "SeasonSearch", status: "queued", body: { seriesId: 27, seasonNumber: 3 } },
    { id: 3, name: "EpisodeSearch", status: "queued", body: { episodeIds: [900] } },
  ];
  it("stops one episode's search without touching season searches", () => {
    expect(episodeSearchesToCancel(commands, [900], null)).toEqual([3]);
  });
  it("stops the cancelled season's search and leaves other seasons alone", () => {
    expect(episodeSearchesToCancel(commands, [900], { seriesId: 27, seasonNumber: 2 })).toEqual([1, 3]);
  });
});
