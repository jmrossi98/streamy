import { describe, it, expect } from "vitest";
import { epgUrlFor, newestReplacement, relinkChannelStreams, type RelinkStream } from "../iptvRelinkRules";

const s = (id: number, name: string, stream_id: number | null, last_seen: string, is_stale = false, acct = 6): RelinkStream => ({
  id,
  name,
  stream_id,
  last_seen,
  is_stale,
  m3u_account: acct,
});

describe("newestReplacement", () => {
  it("follows a login change on the same panel by provider stream id", () => {
    const old = s(1, "ESPN", 501, "2026-10-15", true);
    expect(newestReplacement(old, [old, s(2, "ESPN", 501, "2026-10-16")])?.id).toBe(2);
  });
  it("follows a move to a new panel by exact name", () => {
    const old = s(1, "NBC SPORTS BAY AREA", 501, "2026-10-15", true);
    expect(newestReplacement(old, [old, s(2, "NBC SPORTS BAY AREA", 9001, "2026-10-16")])?.id).toBe(2);
  });
  it("leaves a current stream and never takes a different one", () => {
    const cur = s(1, "ESPN", 501, "2026-10-16");
    expect(newestReplacement(cur, [cur, s(2, "ESPN", 501, "2026-10-10")])).toBeNull();
    const old = s(3, "ESPN", 501, "2026-10-15", true);
    expect(newestReplacement(old, [old, s(4, "ESPN2", 502, "2026-10-16")])).toBeNull();
  });
});

describe("relinkChannelStreams", () => {
  it("moves each stream onto its new copy and keeps the order, leaving others alone", () => {
    const a = s(1, "ESPN", 501, "2026-10-15", true);
    const a2 = s(2, "ESPN", 501, "2026-10-16");
    const b = s(3, "FOX", 600, "2026-10-16", false, 5);
    const byId = new Map([a, a2, b].map((x) => [x.id, x]));
    const pools = new Map([
      [6, [a, a2]],
      [5, [b]],
    ]);
    expect(relinkChannelStreams([3, 1, 99], byId, pools)).toEqual([3, 2, 99]);
  });
});

describe("epgUrlFor", () => {
  it("puts the account's server and login into an xmltv.php guide URL", () => {
    const got = new URL(epgUrlFor("http://old.tv/xmltv.php?username=o&password=p", { serverUrl: "http://new.tv:8080", username: "n", password: "q" })!);
    expect(got.host).toBe("new.tv:8080");
    expect(got.searchParams.get("username")).toBe("n");
    expect(got.searchParams.get("password")).toBe("q");
  });
  it("leaves any other kind of guide alone", () => {
    expect(epgUrlFor("https://epg.example/guide.xml.gz", { serverUrl: "http://x", username: "a", password: "b" })).toBeNull();
  });
});
