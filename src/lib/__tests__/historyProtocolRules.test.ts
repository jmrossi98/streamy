import { describe, expect, it } from "vitest";
import { protocolsFromHistory, type HistoryEvent } from "../historyProtocolRules";

const byEpisode = (e: HistoryEvent) => e.episodeId;

describe("protocolsFromHistory", () => {
  it("takes the protocol of the grab that produced the imported file", () => {
    const events: HistoryEvent[] = [
      { episodeId: 1, eventType: "grabbed", date: "2026-09-24T10:00:00Z", downloadId: "nzo1", data: { protocol: "1" } },
      { episodeId: 1, eventType: "downloadFolderImported", date: "2026-09-24T10:05:00Z", downloadId: "nzo1", data: { downloadClient: "SABnzbd" } },
      // A later torrent re-grab that never imported must not relabel the file.
      { episodeId: 1, eventType: "grabbed", date: "2026-09-25T10:00:00Z", downloadId: "HASH", data: { protocol: "2" } },
    ];
    expect(protocolsFromHistory(events, byEpisode).get(1)).toBe("usenet");
  });

  it("falls back to the importing client when the grab is gone", () => {
    const events: HistoryEvent[] = [
      { episodeId: 2, eventType: "downloadFolderImported", date: "2026-09-24T10:05:00Z", downloadId: "abc", data: { downloadClient: "qBittorrent" } },
    ];
    expect(protocolsFromHistory(events, byEpisode).get(2)).toBe("torrent");
  });

  it("leaves a manual import unlabelled", () => {
    const events: HistoryEvent[] = [{ episodeId: 3, eventType: "downloadFolderImported", date: "2026-09-24T10:05:00Z", data: {} }];
    expect(protocolsFromHistory(events, byEpisode).has(3)).toBe(false);
  });

  it("uses the newest import when a file was upgraded", () => {
    const events: HistoryEvent[] = [
      { episodeId: 4, eventType: "downloadFolderImported", date: "2026-09-20T00:00:00Z", data: { downloadClient: "qBittorrent" } },
      { episodeId: 4, eventType: "downloadFolderImported", date: "2026-09-27T00:00:00Z", data: { downloadClient: "SABnzbd" } },
    ];
    expect(protocolsFromHistory(events, byEpisode).get(4)).toBe("usenet");
  });
});
