import { describe, expect, it } from "vitest";
import { applyFilters, parseApiCommand, redactJson, redactText, splitPipes } from "../diagApiRules";

const ok = (cmd: string) => parseApiCommand(cmd) as { service: string; path: string };
const refused = (cmd: string) => "error" in parseApiCommand(cmd);

describe("parseApiCommand", () => {
  it("accepts readable paths, with or without the API prefix", () => {
    expect(ok("radarr /queue?pageSize=50")).toEqual({ service: "radarr", path: "/api/v3/queue?pageSize=50" });
    expect(ok("sonarr /api/v3/history/series?seriesId=27").path).toBe("/api/v3/history/series?seriesId=27");
    expect(ok("prowlarr indexerstatus").path).toBe("/api/v1/indexerstatus");
    expect(ok("qbittorrent torrents/info?filter=downloading").path).toBe("/api/v2/torrents/info?filter=downloading");
    expect(ok("jellyfin /System/ActivityLog/Entries?limit=20").path).toBe("/System/ActivityLog/Entries?limit=20");
    expect(ok("dispatcharr proxy/ts/status").path).toBe("/proxy/ts/status");
    // A queue read always gets a full page, whether or not it was asked for.
    expect(ok("sonarr /queue").path).toBe("/api/v3/queue?pageSize=200");
    expect(ok("radarr /queue?includeMovie=true").path).toBe("/api/v3/queue?includeMovie=true&pageSize=200");
  });

  it("refuses anything that holds credentials or is not on the list", () => {
    for (const cmd of [
      "radarr /indexer",
      "radarr /downloadclient",
      "sonarr /config/host",
      "sonarr /notification",
      "prowlarr /indexer",
      "prowlarr /applications",
      "qbittorrent app/preferences",
      "jellyfin /Auth/Keys",
      "jellyfin /Devices",
      "jellyfin /System/Configuration",
      "jellyfin /Users",
      "dispatcharr /api/m3u/accounts/",
      "radarr /../../etc/passwd",
      "radarr http://evil.example/steal",
      "nope /queue",
      "radarr",
    ]) {
      expect(refused(cmd), cmd).toBe(true);
    }
  });

  it("lets SABnzbd read but never act", () => {
    expect(ok("sabnzbd mode=queue&limit=5").path).toBe("/api?mode=queue&limit=5&output=json");
    expect(ok("sabnzbd /api?mode=history").path).toContain("mode=history");
    // The call that once regenerated the key and took Streamy down, and friends.
    for (const cmd of [
      "sabnzbd mode=config&name=set_apikey",
      "sabnzbd mode=queue&name=delete&value=all",
      "sabnzbd mode=pause",
      "sabnzbd mode=set_config&section=misc",
      "sabnzbd mode=shutdown",
      "sabnzbd mode=queue&name=pause",
    ]) {
      expect(refused(cmd), cmd).toBe(true);
    }
  });
});

describe("redaction", () => {
  it("blanks secret-named fields and *arr name/value settings", () => {
    expect(
      redactJson({
        title: "ok",
        apiKey: "abc123",
        nested: { password: "hunter2", Token: "t", port: 8080, useSsl: true },
        fields: [{ name: "apiKey", value: "zzz" }, { name: "baseUrl", value: "http://x" }],
      })
    ).toEqual({
      title: "ok",
      apiKey: "[redacted]",
      nested: { password: "[redacted]", Token: "[redacted]", port: 8080, useSsl: true },
      fields: [{ name: "apiKey", value: "[redacted]" }, { name: "baseUrl", value: "http://x" }],
    });
  });

  it("strips credentials from URLs, including IPTV stream paths", () => {
    expect(redactText("http://line.example.com/live/c4bbdaa4cf/20784a63e92d/549566.ts")).toBe(
      "http://line.example.com/live/[redacted]/[redacted]/549566.ts"
    );
    expect(redactText("http://x/get.php?username=bob&password=pw&type=m3u")).toBe(
      "http://x/get.php?username=[redacted]&password=[redacted]&type=m3u"
    );
    expect(redactText("https://user:secret@host/path")).toBe("https://user:[redacted]@host/path");
  });
});

describe("pipes", () => {
  it("splits and applies grep, head, tail and wc", () => {
    const { head, stages } = splitPipes('api radarr /queue | grep -i "sizeleft" | head -2');
    expect(head).toBe("api radarr /queue");
    const text = ['"title": "A"', '"sizeleft": 1', '"SizeLeft": 2', '"sizeleft": 3'].join("\n");
    expect(applyFilters(text, stages)).toBe('"sizeleft": 1\n"SizeLeft": 2');
    expect(applyFilters(text, [["grep", "-v", "size"], ["wc", "-l"]])).toBe("2");
    expect(() => applyFilters(text, [["sh", "-c", "x"]])).toThrow();
  });
});
