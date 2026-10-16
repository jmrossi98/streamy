import { describe, it, expect } from "vitest";
import {
  compareReleases,
  currentSeason,
  deriveGameStatus,
  eventTeams,
  isFinished,
  pickRecording,
  recentFinishedEvents,
  releaseDate,
  releaseMatchesEvent,
  resolutionOf,
  searchQuery,
  teamKeyword,
  type SportarrEvent,
  type SportarrRelease,
} from "../sportarrRules";

// 2026-10-16 03:00Z: the evening's games have started, yesterday's are over.
const NOW = Date.parse("2026-10-16T03:00:00Z");

function event(over: Partial<SportarrEvent> & { id: number }): SportarrEvent {
  return {
    title: "Washington Capitals vs Montreal Canadiens",
    leagueId: 1,
    leagueName: "NHL",
    eventDate: "2026-10-14T23:30:00Z",
    status: "completed",
    hasFile: false,
    filePath: null,
    fileSize: null,
    quality: null,
    homeScore: 5,
    awayScore: 4,
    homeTeamName: null,
    awayTeamName: null,
    ...over,
  };
}

function release(title: string, over: Partial<SportarrRelease> = {}): SportarrRelease {
  return { title, guid: title, protocol: "Usenet", size: 9_000_000_000, quality: "WEBDL-720p", seeders: null, ...over };
}

// Real release names from a live search on 2026-10-16.
const THIS_GAME_720 = "NHL.2026.10.14.Montreal.Canadiens.Vs.Washington.Capitals.720p.WEB.H264-NiGHTNiNJAS";
const OLD_MEETING = "NHL.2023.04.06.Washington.Capitals.vs.Montreal.Canadiens.720p.WEB.h264-SPORTSNET";

describe("eventTeams / teamKeyword", () => {
  it("splits the title, home first, when the team fields are null", () => {
    expect(eventTeams(event({ id: 1 }))).toEqual({ home: "Washington Capitals", away: "Montreal Canadiens" });
  });

  it("prefers the team fields when Sportarr fills them", () => {
    expect(eventTeams(event({ id: 1, homeTeamName: "A", awayTeamName: "B" }))).toEqual({ home: "A", away: "B" });
  });

  it("keys a team by the last word of its name", () => {
    expect(teamKeyword("Detroit Red Wings")).toBe("wings");
    expect(teamKeyword("St. Louis Blues")).toBe("blues");
    expect(teamKeyword("Utah Mammoth")).toBe("mammoth");
    expect(teamKeyword("Portland Trail Blazers")).toBe("blazers");
  });

  it("searches by both team names only -- a date in the query finds nothing", () => {
    expect(searchQuery(event({ id: 1 }))).toBe("Washington Capitals Montreal Canadiens");
  });
});

describe("releaseDate", () => {
  it("reads dotted, dashed and spaced dates", () => {
    expect(releaseDate(THIS_GAME_720)).toBe("2026-10-14");
    expect(releaseDate("NFL 2026-10-12 Bills vs Jets 1080p")).toBe("2026-10-12");
    expect(releaseDate("NBA 2026 10 20 Lakers at Celtics")).toBe("2026-10-20");
  });

  it("ignores names with no date, or an impossible one", () => {
    expect(releaseDate("Capitals.vs.Canadiens.720p")).toBeNull();
    expect(releaseDate("NHL.2026.13.40.X.vs.Y")).toBeNull();
  });
});

describe("releaseMatchesEvent", () => {
  const game = event({ id: 4845 });

  it("accepts the game's own release, whichever way round the teams are written", () => {
    expect(releaseMatchesEvent(release(THIS_GAME_720), game)).toBe(true);
  });

  it("rejects an earlier meeting of the same two teams", () => {
    expect(releaseMatchesEvent(release(OLD_MEETING), game)).toBe(false);
  });

  it("rejects a same-day game with a different opponent", () => {
    expect(releaseMatchesEvent(release("NHL.2026.10.14.Boston.Bruins.vs.Washington.Capitals.720p"), game)).toBe(false);
  });

  it("allows a day of slack for a late game that is already tomorrow in UTC", () => {
    const late = event({ id: 2, title: "Los Angeles Kings vs Edmonton Oilers", eventDate: "2026-10-14T02:30:00Z" });
    expect(releaseMatchesEvent(release("NHL.2026.10.13.Edmonton.Oilers.vs.Los.Angeles.Kings.1080p"), late)).toBe(true);
    expect(releaseMatchesEvent(release("NHL.2026.10.11.Edmonton.Oilers.vs.Los.Angeles.Kings.1080p"), late)).toBe(false);
  });

  it("needs a date in the name at all", () => {
    expect(releaseMatchesEvent(release("Washington.Capitals.vs.Montreal.Canadiens.720p"), game)).toBe(false);
  });
});

describe("compareReleases / pickRecording", () => {
  const game = event({ id: 4845 });
  const p1080 = release(THIS_GAME_720.replace("720p", "1080p"), { quality: "WEBDL-1080p" });
  const p720usenet = release(THIS_GAME_720);
  const p720torrent = release(THIS_GAME_720, { protocol: "Torrent", seeders: 40 });
  const p2160 = release(THIS_GAME_720.replace("720p", "2160p"), { quality: "WEBDL-2160p" });

  it("ranks 1080p, then 720p, with 4K last", () => {
    const sorted = [p2160, p720usenet, p1080].sort(compareReleases);
    expect(sorted.map((r) => r.quality)).toEqual(["WEBDL-1080p", "WEBDL-720p", "WEBDL-2160p"]);
  });

  it("prefers usenet to a torrent of the same resolution", () => {
    expect([p720torrent, p720usenet].sort(compareReleases)[0]).toBe(p720usenet);
  });

  it("prefers the better-seeded torrent", () => {
    const weak = release(THIS_GAME_720, { protocol: "Torrent", seeders: 2 });
    expect([weak, p720torrent].sort(compareReleases)[0]).toBe(p720torrent);
  });

  it("picks the best match and ignores the other meetings in the results", () => {
    expect(pickRecording([release(OLD_MEETING, { quality: "WEBDL-1080p" }), p720usenet, p1080], game)).toBe(p1080);
  });

  it("returns null when nothing in the results is this game", () => {
    expect(pickRecording([release(OLD_MEETING)], game)).toBeNull();
    expect(pickRecording([], game)).toBeNull();
  });

  it("reads the resolution out of Sportarr's quality names", () => {
    expect(resolutionOf("HDTV-1080p")).toBe(1080);
    expect(resolutionOf("WEBDL-720p")).toBe(720);
    expect(resolutionOf(null)).toBeNull();
  });
});

describe("isFinished / recentFinishedEvents", () => {
  it("trusts Sportarr's completed status", () => {
    expect(isFinished(event({ id: 1, status: "completed", eventDate: "2026-10-16T02:00:00Z" }), NOW)).toBe(true);
  });

  it("calls a game over by the clock when Sportarr still says scheduled", () => {
    // 23:00Z kickoff, four hours ago.
    expect(isFinished(event({ id: 1, status: "scheduled", eventDate: "2026-10-15T23:00:00Z" }), NOW)).toBe(true);
    // 01:00Z kickoff, two hours ago: still on.
    expect(isFinished(event({ id: 1, status: "scheduled", eventDate: "2026-10-16T01:00:00Z" }), NOW)).toBe(false);
  });

  it("lists finished games from the last three days, newest first, and nothing else", () => {
    const events = [
      event({ id: 1, eventDate: "2026-10-13T23:00:00Z" }),
      event({ id: 2, eventDate: "2026-10-15T23:00:00Z", status: "scheduled" }),
      event({ id: 3, eventDate: "2026-10-16T01:00:00Z", status: "scheduled" }), // still on
      event({ id: 4, eventDate: "2026-10-16T23:00:00Z", status: "scheduled" }), // tonight
      event({ id: 5, eventDate: "2026-10-09T23:00:00Z" }), // too old
      event({ id: 6, eventDate: "2026-10-14T23:00:00Z", status: "postponed" }),
    ];
    expect(recentFinishedEvents(events, NOW).map((e) => e.id)).toEqual([2, 1]);
  });
});

describe("deriveGameStatus", () => {
  const finished = event({ id: 1 });

  it("goes ready > downloading > upcoming > live > the search answer", () => {
    expect(deriveGameStatus({ ...finished, hasFile: true }, { queued: true, nowMs: NOW })).toBe("ready");
    expect(deriveGameStatus(finished, { queued: true, nowMs: NOW })).toBe("downloading");
    expect(deriveGameStatus(event({ id: 2, status: "scheduled", eventDate: "2026-10-16T23:00:00Z" }), { queued: false, nowMs: NOW })).toBe("upcoming");
    expect(deriveGameStatus(event({ id: 3, status: "scheduled", eventDate: "2026-10-16T01:00:00Z" }), { queued: false, nowMs: NOW })).toBe("live");
    expect(deriveGameStatus(finished, { queued: false, nowMs: NOW })).toBe("finished");
    expect(deriveGameStatus(finished, { queued: false, nowMs: NOW, check: { release: null } })).toBe("no-recording");
    expect(deriveGameStatus(finished, { queued: false, nowMs: NOW, check: { release: release(THIS_GAME_720) } })).toBe("recording-available");
  });
});

describe("currentSeason", () => {
  const seasons = [
    { season: "2026-2027", firstEventDate: "2026-10-07T23:00:00Z", lastEventDate: "2027-04-11T02:30:00Z" },
    { season: "2025-2026", firstEventDate: "2025-10-07T23:00:00Z", lastEventDate: "2026-06-20T00:00:00Z" },
  ];

  it("picks the season that contains today", () => {
    expect(currentSeason(seasons, NOW)).toBe("2026-2027");
    expect(currentSeason(seasons, Date.parse("2026-03-01T00:00:00Z"))).toBe("2025-2026");
  });

  it("falls back to the most recent season that has started, in the off-season", () => {
    expect(currentSeason(seasons, Date.parse("2026-08-01T00:00:00Z"))).toBe("2025-2026");
  });

  it("answers null with nothing to choose from", () => {
    expect(currentSeason([], NOW)).toBeNull();
  });
});
