import { describe, it, expect } from "vitest";
import {
  airDay,
  sameTitle,
  seasonInOtherNumbering,
  toOtherNumbering,
  type AirDates,
  type EpisodeRef,
  type SeasonCounts,
  type TmdbLayout,
} from "../episodeNumbering";

const season = (s: number, n: number): EpisodeRef[] => Array.from({ length: n }, (_, i) => ({ season: s, episode: i + 1 }));
const layout = (counts: SeasonCounts, airDates?: AirDates): TmdbLayout => ({ counts, airDates });

// Frieren, 2026-10-17: TMDB one season of 38, TVDB (Sonarr/Jellyfin) 28 + 10.
const FRIEREN_TMDB = layout({ 1: 38 });
const FRIEREN_TVDB = [...season(0, 3), ...season(1, 28), ...season(2, 10)];

describe("toOtherNumbering", () => {
  it("finds TMDB's episode 29 as TVDB's season 2 episode 1", () => {
    expect(toOtherNumbering(FRIEREN_TMDB, FRIEREN_TVDB, { season: 1, episode: 29 })).toEqual({ season: 2, episode: 1 });
    expect(toOtherNumbering(FRIEREN_TMDB, FRIEREN_TVDB, { season: 1, episode: 38 })).toEqual({ season: 2, episode: 10 });
    expect(toOtherNumbering(FRIEREN_TMDB, FRIEREN_TVDB, { season: 1, episode: 39 })).toBeNull();
  });
  it("leaves an episode both sides number the same alone", () => {
    expect(toOtherNumbering(FRIEREN_TMDB, FRIEREN_TVDB, { season: 1, episode: 5 })).toEqual({ season: 1, episode: 5 });
    const tmdb = layout({ 1: 10, 2: 10 });
    const other = [...season(1, 10), ...season(2, 12)]; // TVDB lists two more, unaired
    expect(toOtherNumbering(tmdb, other, { season: 2, episode: 3 })).toEqual({ season: 2, episode: 3 });
  });
  it("matches by position when an earlier season is split differently", () => {
    // TMDB 12 + 12, TVDB one season of 24.
    expect(toOtherNumbering(layout({ 1: 12, 2: 12 }), season(1, 24), { season: 2, episode: 1 })).toEqual({ season: 1, episode: 13 });
  });
  it("never translates specials, nor anything without TMDB's layout", () => {
    expect(toOtherNumbering(FRIEREN_TMDB, FRIEREN_TVDB, { season: 0, episode: 2 })).toEqual({ season: 0, episode: 2 });
    expect(toOtherNumbering(null, FRIEREN_TVDB, { season: 1, episode: 29 })).toBeNull();
  });
});

describe("seasonInOtherNumbering", () => {
  it("covers both TVDB seasons for Frieren's single TMDB season", () => {
    const got = seasonInOtherNumbering(FRIEREN_TMDB, FRIEREN_TVDB, 1);
    expect(got).toHaveLength(38);
    expect(got[28]).toEqual({ tmdbEpisode: 29, other: { season: 2, episode: 1 } });
  });
  it("is the other side's whole season when the layouts agree, extra episodes included", () => {
    const other = [...season(1, 10), ...season(2, 12)];
    const got = seasonInOtherNumbering(layout({ 1: 10, 2: 10 }), other, 2);
    expect(got).toHaveLength(12);
    expect(got[11]).toEqual({ tmdbEpisode: 12, other: { season: 2, episode: 12 } });
    expect(seasonInOtherNumbering(null, other, 2)).toHaveLength(12);
  });
});

describe("air dates settle layouts that differ", () => {
  // Potomac, 2026-10-19: TMDB counts 23 in season 6, TVDB 22, and every later
  // season agreed -- but by position alone S11E02 came out as S11E03.
  const tvdb: EpisodeRef[] = [
    ...season(1, 12),
    ...season(6, 22),
    ...season(10, 20),
    { season: 11, episode: 1, airDate: "2026-10-11" },
    { season: 11, episode: 2, airDate: "2026-10-18" },
    { season: 11, episode: 3, airDate: "2026-10-25" },
  ];
  const tmdb = layout(
    { 1: 12, 6: 23, 10: 20, 11: 10 },
    { "11:1": "2026-10-11", "11:2": "2026-10-18", "11:3": "2026-10-25", "11:4": "2026-11-01" }
  );

  it("matches the episode that aired the same day, whatever the count before it", () => {
    expect(toOtherNumbering(tmdb, tvdb, { season: 11, episode: 2 })).toMatchObject({ season: 11, episode: 2 });
    expect(toOtherNumbering(tmdb, tvdb, { season: 11, episode: 3 })).toMatchObject({ season: 11, episode: 3 });
  });

  it("has nothing for an episode the other side has not listed yet", () => {
    expect(toOtherNumbering(tmdb, tvdb, { season: 11, episode: 4 })).toBeNull();
  });

  it("lists a season by air date too", () => {
    const got = seasonInOtherNumbering(tmdb, tvdb, 11);
    expect(got.map((g) => [g.tmdbEpisode, g.other.episode])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it("keeps the episode's own number on a night two aired, and falls back to position without a date", () => {
    const night: EpisodeRef[] = [
      ...season(1, 10),
      { season: 2, episode: 1, airDate: "2026-01-05" },
      { season: 2, episode: 2, airDate: "2026-01-05" },
    ];
    const twoCount = layout({ 1: 11, 2: 2 }, { "2:2": "2026-01-05" });
    expect(toOtherNumbering(twoCount, night, { season: 2, episode: 2 })).toMatchObject({ season: 2, episode: 2 });
    // No date known for TMDB's episode: the old positional rule still applies.
    expect(toOtherNumbering(layout({ 1: 12, 2: 12 }), season(1, 24), { season: 2, episode: 1 })).toEqual({ season: 1, episode: 13 });
  });

  it("reads a day from a date or an ISO datetime", () => {
    expect(airDay("2026-10-18")).toBe("2026-10-18");
    expect(airDay("2026-10-18T00:00:00.0000000Z")).toBe("2026-10-18");
    expect(airDay("")).toBeNull();
    expect(airDay(null)).toBeNull();
  });
});

// SpongeBob season 2, 2026-10-31: 36 episodes on both sides, ordered
// differently. TMDB has "Christmas Who?" at 9; TVDB files it as a special and
// has "Gary Takes a Bath" at 20. Playing Shanghaied played The Smoking Peanut.
const SB_TMDB_S2 = [
  "Something Smells", "Bossy Boots", "Your Shoe's Untied", "Squid's Day Off", "Big Pink Loser", "Bubble Buddy",
  "Mermaid Man & Barnacle Boy III", "Squirrel Jokes", "Christmas Who?", "Dying for Pie", "Imitation Krabs", "Wormy",
  "Patty Hype", "Survival of the Idiots", "Dumped", "Grandma's Kisses", "Squidville", "No Free Rides",
  "I'm Your Biggest Fanatic", "Pressure", "The Smoking Peanut", "Shanghaied", "Prehibernation Week", "Life of Crime",
  "The Secret Box", "Band Geeks", "Sailor Mouth", "Artist Unknown", "Jellyfish Hunter", "The Fry Cook Games",
  "Just One Bite", "The Bully", "Squid on Strike", "Sandy, SpongeBob, and the Worm", "Procrastination", "I'm with Stupid",
];
const SB_TVDB_S2 = [
  "Something Smells", "Bossy Boots", "Your Shoe's Untied", "Squid's Day Off", "Big Pink Loser", "Bubble Buddy",
  "Mermaid Man and Barnacle Boy III", "Squirrel Jokes", "Dying for Pie", "Imitation Krabs", "Wormy", "Patty Hype",
  "Survival of the Idiots", "Dumped", "Grandma's Kisses", "Squidville", "No Free Rides", "I'm Your Biggest Fanatic",
  "Shanghaied", "Gary Takes a Bath", "Pressure", "The Smoking Peanut", "Prehibernation Week", "Life of Crime",
  "The Secret Box", "Band Geeks", "Sailor Mouth", "Artist Unknown", "Jellyfish Hunter", "The Fry Cook Games",
  "Just One Bite", "The Bully", "Squid on Strike", "Sandy, SpongeBob, and the Worm", "Procrastination", "I'm with Stupid",
];
const SB_TMDB: TmdbLayout = {
  counts: { 1: 2, 2: 36 },
  titles: Object.fromEntries(SB_TMDB_S2.map((t, i) => [`2:${i + 1}`, t])),
};
const SB_TVDB: EpisodeRef[] = [
  { season: 0, episode: 1, title: "Christmas Who?" },
  { season: 1, episode: 1, title: "Help Wanted" },
  { season: 1, episode: 2, title: "Reef Blower" },
  ...SB_TVDB_S2.map((title, i) => ({ season: 2, episode: i + 1, title })),
];

describe("toOtherNumbering by title", () => {
  it("finds Shanghaied where TVDB numbers it, not at the same number", () => {
    expect(toOtherNumbering(SB_TMDB, SB_TVDB, { season: 2, episode: 22 })).toMatchObject({ season: 2, episode: 19 });
    expect(toOtherNumbering(SB_TMDB, SB_TVDB, { season: 2, episode: 21 })).toMatchObject({ season: 2, episode: 22 });
    expect(toOtherNumbering(SB_TMDB, SB_TVDB, { season: 2, episode: 10 })).toMatchObject({ season: 2, episode: 9 });
  });
  it("finds an episode TVDB files as a special", () => {
    expect(toOtherNumbering(SB_TMDB, SB_TVDB, { season: 2, episode: 9 })).toMatchObject({ season: 0, episode: 1 });
  });
  it("keeps the same number when the names agree, & and 'and' alike", () => {
    expect(toOtherNumbering(SB_TMDB, SB_TVDB, { season: 2, episode: 7 })).toMatchObject({ season: 2, episode: 7 });
    expect(toOtherNumbering(SB_TMDB, SB_TVDB, { season: 2, episode: 30 })).toMatchObject({ season: 2, episode: 30 });
  });
  it("ignores placeholder names and names it can't place", () => {
    const tmdb: TmdbLayout = { counts: { 1: 3 }, titles: { "1:2": "Episode 2", "1:3": "Something Else" } };
    const other: EpisodeRef[] = [1, 2, 3].map((e) => ({ season: 1, episode: e, title: `Episode ${e + 1}` }));
    expect(toOtherNumbering(tmdb, other, { season: 1, episode: 2 })).toMatchObject({ season: 1, episode: 2 });
    expect(toOtherNumbering(tmdb, other, { season: 1, episode: 3 })).toMatchObject({ season: 1, episode: 3 });
  });
  it("maps a whole season by title when the names disagree", () => {
    const mapped = seasonInOtherNumbering(SB_TMDB, SB_TVDB, 2);
    const at = (e: number) => mapped.find((m) => m.tmdbEpisode === e)?.other;
    expect(at(22)).toMatchObject({ season: 2, episode: 19, title: "Shanghaied" });
    expect(at(9)).toMatchObject({ season: 0, episode: 1 });
    expect(mapped).toHaveLength(36);
  });
});

describe("sameTitle", () => {
  it("compares names, not spelling", () => {
    expect(sameTitle("The Smoking Peanut", "Smoking Peanut")).toBe(true);
    expect(sameTitle("Shanghaied", "The Smoking Peanut")).toBe(false);
    expect(sameTitle("Episode 4", "Shanghaied")).toBeNull();
    expect(sameTitle(null, "Shanghaied")).toBeNull();
  });
});
