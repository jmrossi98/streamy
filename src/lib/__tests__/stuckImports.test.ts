import { describe, it, expect } from "vitest";
import { isConfidenceBlockedQueueItem, type QueueItemForImportCheck } from "../radarr";

// The Radarr/Sonarr admin-panel warning ("N titles need Manual Import") and
// the mediabox's auto-import-safe.py cron both key off this exact
// classification -- getting it wrong either buries a title that genuinely
// needs a human (a real quality rejection reported as fine) or, worse, tells
// the cron something is safe to auto-confirm when it isn't. Real occurrence
// this locks in: "The Hunt (Jagten) (2012)" sat blocked for hours before
// anyone noticed, on exactly this message.
describe("isConfidenceBlockedQueueItem", () => {
  const blocked = (over: Partial<QueueItemForImportCheck> = {}): QueueItemForImportCheck => ({
    trackedDownloadState: "importBlocked",
    status: "completed",
    sizeleft: 0,
    statusMessages: [{ messages: ["Found matching movie via grab history, but release was matched to movie by ID. Manual Import required."] }],
    ...over,
  });

  it("flags the real confidence-block message this exists for", () => {
    expect(isConfidenceBlockedQueueItem(blocked())).toBe(true);
  });

  it("also matches the plausible Sonarr wording (series/episode, not movie)", () => {
    expect(
      isConfidenceBlockedQueueItem(
        blocked({
          statusMessages: [{ messages: ["Found matching series via grab history, but release was matched to series by ID. Manual Import required."] }],
        })
      )
    ).toBe(true);
  });

  it("ignores an item that isn't actually importBlocked", () => {
    expect(isConfidenceBlockedQueueItem(blocked({ trackedDownloadState: "downloading" }))).toBe(false);
  });

  it("ignores an importBlocked item that hasn't actually finished downloading", () => {
    // status can be importBlocked for other reasons mid-download too --
    // only a genuinely completed transfer is the "why is this stuck at
    // 100%" case this is meant to catch.
    expect(isConfidenceBlockedQueueItem(blocked({ status: "downloading", sizeleft: 500 }))).toBe(false);
    expect(isConfidenceBlockedQueueItem(blocked({ sizeleft: 100 }))).toBe(false);
  });

  it("does not flag a real quality rejection or missing-file block -- those need a human, not auto-resolution", () => {
    expect(
      isConfidenceBlockedQueueItem(
        blocked({ statusMessages: [{ messages: ["Not a Custom Format upgrade for existing movie file(s)"] }] })
      )
    ).toBe(false);
    expect(
      isConfidenceBlockedQueueItem(blocked({ statusMessages: [{ messages: ["No files found are eligible for import"] }] }))
    ).toBe(false);
  });

  it("handles a missing statusMessages array without throwing", () => {
    expect(isConfidenceBlockedQueueItem(blocked({ statusMessages: undefined }))).toBe(false);
  });
});
