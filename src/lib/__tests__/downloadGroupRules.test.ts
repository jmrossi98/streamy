import { describe, it, expect } from "vitest";
import {
  showProgress,
  episodeCount,
  foldPacks,
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

// Sonarr queues a season pack once per episode it covers. Frieren's 46 GB
// pack showed as 28 identical torrents adding up to 1.2 TB.
describe("foldPacks", () => {
  const pack = (episodeNumber: number) =>
    ep({ completed: false, progress: 7, downloadId: "EE07", sizeBytes: 46e9, episodeNumber, title: "Frieren.S01.2160p" });

  it("shows one transfer once, standing for every episode in it", () => {
    const rows = foldPacks([pack(3), pack(1), pack(2)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].episodeNumber).toBe(1);
    expect(rows[0].packEpisodes).toBe(3);
    expect(groupSize(rows)).toBe(46e9);
    expect(episodeCount(rows)).toBe(3);
    expect(groupSummary(rows)).toBe("3 episodes · 3 downloading");
  });

  it("leaves separate downloads, finished episodes and movies alone", () => {
    const rows = [
      ep({ completed: false, downloadId: "A", episodeNumber: 1 }),
      ep({ completed: false, downloadId: "B", episodeNumber: 2 }),
      ep({ completed: true, downloadId: "A", episodeNumber: 3 }),
      ep({ completed: false, episodeNumber: 4 }),
      movie("Heat"),
    ];
    expect(foldPacks(rows)).toEqual(rows);
  });
});

// Atlanta read 95% and then 88%: the average of what was transferring fell as
// finished episodes left it and fresh ones joined.
describe("showProgress", () => {
  const moving = (progress: number, episodeNumber: number) =>
    ep({ completed: false, progress, episodeNumber, seriesEpisodes: 10 });
  const queued = (episodeNumber: number) => ep({ completed: false, queued: true, episodeNumber, seriesEpisodes: 10 });

  it("counts what is left against the whole show", () => {
    // 10 episodes: 6 on disk and not listed, two at 50%, two queued.
    expect(showProgress([moving(50, 7), moving(50, 8), queued(9), queued(10)])).toBe(70);
  });

  it("goes up, not down, when an episode finishes and the next one starts", () => {
    const before = showProgress([moving(95, 7), moving(95, 8), queued(9), queued(10)]);
    const after = showProgress([moving(0, 9), queued(10)]);
    expect(before).toBe(79);
    expect(after).toBe(80);
    expect(groupProgress([moving(0, 9), queued(10)])).toBe(80);
  });

  it("counts a pack as every episode in it", () => {
    expect(showProgress([{ ...moving(50, 1), packEpisodes: 10 }])).toBe(50);
  });

  it("says nothing when the show's size is unknown, leaving the old average", () => {
    const rows = [ep({ completed: false, progress: 40 }), ep({ completed: false, progress: 60, episodeNumber: 2 })];
    expect(showProgress(rows)).toBeNull();
    expect(groupProgress(rows)).toBe(50);
  });
});
