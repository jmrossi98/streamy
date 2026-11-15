import { describe, it, expect } from "vitest";
import {
  BATCH_MEMBER_GRACE_MS,
  batchProgress,
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
  nextShowBatches,
  seasonLabel,
  type GroupableRow,
  type KeyedRow,
  type ShowBatches,
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
describe("a show's batch", () => {
  type Row = GroupableRow & KeyedRow;
  const at = (episodeId: number, over: Partial<Row> = {}): Row => ({ ...ep({ episodeNumber: episodeId }), episodeId, ...over });
  const moving = (episodeId: number, progress: number) => at(episodeId, { completed: false, progress });
  const queued = (episodeId: number) => at(episodeId, { completed: false, queued: true });
  const onDisk = (episodeId: number) => at(episodeId);
  const library = Array.from({ length: 300 }, (_, i) => onDisk(1000 + i));

  function run(...refreshes: Row[][]): number | null {
    let batches: ShowBatches = new Map();
    refreshes.forEach((rows, i) => {
      batches = nextShowBatches(batches, rows, i * 5_000);
    });
    const members = batches.get(19);
    return members ? batchProgress(members) : null;
  }

  it("is the episode's own progress, not the whole show's", () => {
    // Counted against 300 episodes on disk this read 100%.
    expect(run([...library, moving(1, 20)])).toBe(20);
  });

  it("goes up, not down, when an episode finishes and the next one starts", () => {
    const before = [moving(7, 95), moving(8, 95), queued(9), queued(10)];
    const after = [onDisk(7), onDisk(8), moving(9, 0), queued(10)];
    expect(run(before)).toBe(47);
    expect(run(before, after)).toBe(50);
  });

  it("is never 100 while something is still to come", () => {
    const rows = Array.from({ length: 299 }, (_, i) => onDisk(i + 1));
    const all = rows.map((r) => ({ ...r, completed: false, progress: 0 }));
    expect(run([...all, moving(300, 0)], [...rows, moving(300, 99)])).toBe(99);
  });

  it("counts a pack as every episode in it", () => {
    expect(run([{ ...moving(1, 50), packEpisodes: 10 }, queued(11)])).toBe(45);
  });

  it("drops what will not arrive, and keeps an import's brief gap", () => {
    const start = [moving(1, 100), queued(2)];
    // Mid-import: the queue entry is gone and the file not yet listed.
    expect(run(start, [queued(2)])).toBe(50);
    expect(run(start, [at(2, { completed: false, noRelease: true }), moving(3, 40)])).toBe(70);
  });

  it("forgets a download gone for good", () => {
    let batches = nextShowBatches(new Map(), [moving(1, 0), moving(2, 50)], 0);
    batches = nextShowBatches(batches, [moving(2, 50)], BATCH_MEMBER_GRACE_MS + 1);
    expect(batchProgress(batches.get(19)!)).toBe(50);
  });

  it("ends when nothing of the show is in flight, and the next one starts fresh", () => {
    let batches = nextShowBatches(new Map(), [moving(1, 50)], 0);
    batches = nextShowBatches(batches, [onDisk(1)], 5_000);
    expect(batches.has(19)).toBe(false);
    batches = nextShowBatches(batches, [onDisk(1), moving(2, 10)], 10_000);
    expect(batchProgress(batches.get(19)!)).toBe(10);
  });

  it("is what the header shows, with the old average when there is none", () => {
    const rows = [ep({ completed: false, progress: 40 }), ep({ completed: false, progress: 60, episodeNumber: 2 })];
    expect(groupProgress(rows)).toBe(50);
    expect(groupProgress(rows.map((r) => ({ ...r, seriesProgress: 12 })))).toBe(12);
    // A batch with nothing moving and nothing done says nothing, like before.
    expect(groupProgress([ep({ completed: false, queued: true, seriesProgress: 0 })])).toBeNull();
  });
});
