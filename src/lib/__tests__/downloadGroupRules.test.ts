import { describe, it, expect } from "vitest";
import {
  groupActionLabel,
  groupDownloads,
  groupProgress,
  groupShare,
  groupSize,
  groupStarted,
  groupStatus,
  groupSummary,
  seasonLabel,
  type GroupableRow,
} from "../downloadGroupRules";

function ep(over: Partial<GroupableRow> = {}): GroupableRow {
  return {
    mediaType: "show",
    externalId: 19,
    title: "The.Sopranos.S01E01.1080p",
    completed: true,
    progress: null,
    seriesTitle: "The Sopranos",
    seasonNumber: 1,
    episodeNumber: 1,
    ...over,
  };
}
const movie = (title: string): GroupableRow => ({ mediaType: "movie", externalId: 85, title, completed: true, progress: null });

describe("groupDownloads", () => {
  it("folds a show's episodes into one entry where its first row was, and leaves movies alone", () => {
    const items = groupDownloads([
      movie("Cape Fear"),
      ep({ seasonNumber: 2, episodeNumber: 3 }),
      movie("Ikiru"),
      ep({ seasonNumber: 1, episodeNumber: 2 }),
      ep({ externalId: 28, seriesTitle: "Fanny and Alexander" }),
    ]);
    expect(items.map((i) => (i.kind === "row" ? i.row.title : i.title))).toEqual([
      "Cape Fear",
      "The Sopranos",
      "Ikiru",
      "Fanny and Alexander",
    ]);
  });

  it("orders seasons and episodes for viewing, with Extras and unplaced rows last", () => {
    const [show] = groupDownloads([
      ep({ seasonNumber: null, episodeNumber: null, seriesTitle: null, title: "The Sopranos" }),
      ep({ seasonNumber: 0, episodeNumber: 1 }),
      ep({ seasonNumber: 2, episodeNumber: 10 }),
      ep({ seasonNumber: 2, episodeNumber: 9 }),
      ep({ seasonNumber: 1, episodeNumber: 1 }),
    ]);
    if (show.kind !== "series") throw new Error("expected a series");
    expect(show.title).toBe("The Sopranos");
    expect(show.seasons.map((s) => s.seasonNumber)).toEqual([1, 2, 0, null]);
    expect(show.seasons[1].rows.map((r) => r.episodeNumber)).toEqual([9, 10]);
    expect(show.rows).toHaveLength(5);
  });

  it("falls back to the row's own title when Sonarr gave no series title", () => {
    const [show] = groupDownloads([ep({ seriesTitle: null, title: "Some Show" })]);
    expect(show.kind === "series" && show.title).toBe("Some Show");
  });
});

describe("labels", () => {
  it("names seasons the way the show page does", () => {
    expect([seasonLabel(3), seasonLabel(0), seasonLabel(null)]).toEqual(["Season 3", "Extras", "Other"]);
  });

  it("names the action for what it will do", () => {
    expect(groupActionLabel([{ completed: false }, { completed: false }])).toBe("Cancel");
    expect(groupActionLabel([{ completed: true }])).toBe("Delete");
    expect(groupActionLabel([{ completed: true }, { completed: false }])).toBe("Remove");
  });

  it("summarises a show without the zeroes", () => {
    const rows = [
      ep(),
      ep(),
      ep({ completed: false, progress: 40 }),
      ep({ completed: false, progress: 60 }),
      ep({ completed: false, queued: true }),
      ep({ completed: false, searching: true }),
      ep({ completed: false, noRelease: true }),
    ];
    expect(groupSummary(rows)).toBe("7 episodes · 2 downloading · 1 searching · 1 queued · 1 not found · 2 downloaded");
    expect(groupSummary([ep()])).toBe("1 episode · 1 downloaded");
    expect(groupProgress(rows)).toBe(50);
    expect(groupProgress([ep(), ep({ completed: false, queued: true })])).toBeNull();
  });
});

describe("a show's header, in a movie row's terms", () => {
  it("reads Downloaded when all of it is, otherwise what is still happening", () => {
    expect(groupStatus([ep(), ep()])).toBe("Downloaded");
    expect(groupStatus([ep(), ep({ completed: false, progress: 30 }), ep({ completed: false, queued: true })])).toBe(
      "1 downloading · 1 queued · 1 downloaded · 30%"
    );
  });

  it("adds up size, takes the newest time, and gives the share on disk", () => {
    const rows = [
      ep({ sizeBytes: 1000, startedAt: "2026-09-27T10:00:00Z" }),
      ep({ sizeBytes: 500, startedAt: "2026-09-28T10:00:00Z" }),
      ep({ completed: false, sizeBytes: null, startedAt: null }),
    ];
    expect(groupSize(rows)).toBe(1500);
    expect(groupSize([ep()])).toBeNull();
    expect(groupStarted(rows)).toBe("2026-09-28T10:00:00Z");
    expect(groupShare(rows)).toBe(67);
  });
});
