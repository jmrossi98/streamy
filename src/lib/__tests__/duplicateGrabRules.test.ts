import { describe, it, expect } from "vitest";
import { isDuplicateGrab, isHealthyCopy, sameDownload } from "../duplicateGrabRules";

const downloading = (episodeId: number, downloadId = "SABnzbd_nzo_first") => ({
  downloadId,
  episodeId,
  trackedDownloadState: "downloading",
  trackedDownloadStatus: "ok",
});

describe("isDuplicateGrab", () => {
  it("takes back Sonarr's own grab of an episode that just imported (Potomac S11E4, 2026-11-02)", () => {
    expect(
      isDuplicateGrab({
        releaseSource: "UserInvokedSearch",
        downloadId: "SABnzbd_nzo_second",
        episodes: [{ id: 5229, hasFile: true }],
        queue: [downloading(5229, "SABnzbd_nzo_second")],
      })
    ).toBe(true);
  });

  it("takes back a grab of an episode already downloading in another healthy copy", () => {
    expect(
      isDuplicateGrab({
        releaseSource: "Rss",
        downloadId: "SABnzbd_nzo_second",
        episodes: [{ id: 1, hasFile: false }],
        queue: [downloading(1), downloading(1, "SABnzbd_nzo_second")],
      })
    ).toBe(true);
  });

  it("keeps a grab someone chose: interactive picks and pushes, which is how the deep search grabs", () => {
    for (const releaseSource of ["InteractiveSearch", "ReleasePush"]) {
      expect(
        isDuplicateGrab({ releaseSource, downloadId: "x", episodes: [{ id: 1, hasFile: true }], queue: [] })
      ).toBe(false);
    }
  });

  it("keeps it when how it was grabbed is unknown", () => {
    for (const releaseSource of [null, undefined, "Unknown"]) {
      expect(isDuplicateGrab({ releaseSource, downloadId: "x", episodes: [{ id: 1, hasFile: true }], queue: [] })).toBe(false);
    }
  });

  it("keeps a pack that brings at least one episode nobody has", () => {
    expect(
      isDuplicateGrab({
        releaseSource: "Search",
        downloadId: "pack",
        episodes: [
          { id: 1, hasFile: true },
          { id: 2, hasFile: false },
        ],
        queue: [],
      })
    ).toBe(false);
  });

  it("keeps a replacement for a copy that is failing or stuck", () => {
    for (const other of [
      { ...downloading(1), trackedDownloadStatus: "warning" },
      { ...downloading(1), trackedDownloadState: "failedPending" },
      { ...downloading(1), trackedDownloadState: "importBlocked" },
    ]) {
      expect(
        isDuplicateGrab({ releaseSource: "Search", downloadId: "new", episodes: [{ id: 1, hasFile: false }], queue: [other] })
      ).toBe(false);
    }
  });

  it("does not count the grab's own queue entry as the other copy", () => {
    expect(
      isDuplicateGrab({
        releaseSource: "Search",
        downloadId: "SABnzbd_nzo_ONE",
        episodes: [{ id: 1, hasFile: false }],
        queue: [downloading(1, "sabnzbd_nzo_one")],
      })
    ).toBe(false);
  });

  it("keeps a grab with no episodes listed", () => {
    expect(isDuplicateGrab({ releaseSource: "Search", downloadId: "x", episodes: [], queue: [] })).toBe(false);
  });
});

describe("helpers", () => {
  it("compares download ids without case", () => {
    expect(sameDownload("ABC", "abc")).toBe(true);
    expect(sameDownload("abc", null)).toBe(false);
    expect(sameDownload(undefined, undefined)).toBe(false);
  });

  it("calls a download healthy only while it is on its way with nothing wrong", () => {
    expect(isHealthyCopy(downloading(1))).toBe(true);
    expect(isHealthyCopy({ trackedDownloadState: "importing", trackedDownloadStatus: "ok" })).toBe(true);
    expect(isHealthyCopy({ trackedDownloadState: "imported", trackedDownloadStatus: "ok" })).toBe(false);
    expect(isHealthyCopy({ trackedDownloadState: "downloading", trackedDownloadStatus: "error" })).toBe(false);
  });
});
