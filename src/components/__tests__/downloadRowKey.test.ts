import { describe, it, expect } from "vitest";
import { rowKey, type DownloadRow } from "../DownloadsPanel";

function row(overrides: Partial<DownloadRow>): DownloadRow {
  return {
    queueId: null,
    externalId: 1,
    title: "Something",
    progress: null,
    mediaType: "show",
    completed: false,
    ...overrides,
  };
}

// Regression: rows were keyed by the movie/series id, so every episode of a
// show shared one key and React collapsed them into a single row -- four
// Severance episodes were downloading and only one appeared.
describe("rowKey", () => {
  it("gives each in-flight episode of one series its own key", () => {
    const e1 = row({ queueId: 111, externalId: 1, title: "Severance S01E01" });
    const e2 = row({ queueId: 222, externalId: 1, title: "Severance S01E02" });
    expect(rowKey(e1)).not.toBe(rowKey(e2));
  });

  it("gives each completed episode of one series its own key", () => {
    const e1 = row({ episodeId: 22, externalId: 1, completed: true });
    const e2 = row({ episodeId: 23, externalId: 1, completed: true });
    expect(rowKey(e1)).not.toBe(rowKey(e2));
  });

  it("keeps a completed movie distinct from a completed show with the same id", () => {
    const movie = row({ externalId: 5, mediaType: "movie", completed: true });
    const show = row({ externalId: 5, mediaType: "show", completed: true });
    expect(rowKey(movie)).not.toBe(rowKey(show));
  });

  it("does not collide an in-flight download with a completed title", () => {
    const active = row({ queueId: 7, externalId: 7 });
    const done = row({ externalId: 7, completed: true });
    expect(rowKey(active)).not.toBe(rowKey(done));
  });

  it("is stable across renders for the same download", () => {
    const d = row({ queueId: 42, externalId: 1 });
    expect(rowKey(d)).toBe(rowKey({ ...d }));
  });
});
