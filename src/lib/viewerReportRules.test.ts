import { describe, expect, it } from "vitest";
import { buildViewerReport, type ViewerEventRow } from "./viewerReportRules";

const at = (s: string) => new Date(s);
const ev = (userName: string, when: string, kind: string, media: string, sessionId = `${userName}-1`): ViewerEventRow => ({
  userName,
  at: at(when),
  kind,
  media,
  sessionId,
});

describe("buildViewerReport", () => {
  const now = Date.parse("2026-10-21T02:00:00Z");
  const events = [
    ev("jaker", "2026-10-19T23:00:00Z", "start", "Live: CBS 4"),
    ev("jaker", "2026-10-19T23:05:00Z", "stall", "Live: CBS 4"),
    ev("Ale", "2026-10-19T19:09:00Z", "start", "Potomac S11E2"),
    ev("Ale", "2026-10-20T00:03:00Z", "start", "Potomac S9E4", "Ale-2"),
    ev("Ale", "2026-10-20T18:20:00Z", "start", "Below Deck S13E2", "Ale-2"),
    ev("Ale", "2026-10-20T18:20:05Z", "playing", "Below Deck S13E2", "Ale-2"),
  ];
  const report = buildViewerReport(
    events,
    [
      { userName: "jaker", lastSeenAt: new Date(now - 30_000), playing: JSON.stringify({ media: "Live: ABC 7" }), userAgent: "Mozilla (iPhone)" },
      { userName: "Ale", lastSeenAt: new Date(now - 30 * 60_000), playing: JSON.stringify({ media: "x" }), userAgent: null },
      { userName: "jaker", lastSeenAt: new Date(now - 10_000), playing: null, userAgent: null },
    ],
    at("2026-10-14T02:00:00Z"),
    now
  );

  it("lists every user who watched, most recent first", () => {
    expect(report.users.map((u) => u.user)).toEqual(["Ale", "jaker"]);
    const ale = report.users[0];
    expect(ale.plays).toBe(3);
    expect(ale.sessions).toBe(2);
    expect(ale.titles).toEqual(["Below Deck S13E2", "Potomac S9E4", "Potomac S11E2"]);
    expect(report.users[1].stalls).toBe(1);
  });

  it("shows only recently checked-in tabs that are playing as watching now", () => {
    expect(report.watchingNow).toEqual([{ user: "jaker", playing: "Live: ABC 7", device: "iPhone/iPad" }]);
  });

  it("lists recent starts newest first", () => {
    expect(report.recentStarts[0]).toEqual({ at: "2026-10-20T18:20:00.000Z", user: "Ale", media: "Below Deck S13E2" });
    expect(report.recentStarts).toHaveLength(4);
  });

  it("is empty, not an error, with no events", () => {
    const empty = buildViewerReport([], [], at("2026-10-14T00:00:00Z"), now);
    expect(empty.users).toEqual([]);
    expect(empty.watchingNow).toEqual([]);
  });
});
