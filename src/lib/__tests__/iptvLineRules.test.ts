import { describe, it, expect } from "vitest";
import {
  BACKUP_URLS_KEY,
  deadReason,
  isLineDead,
  isLineLogin,
  lineAlert,
  lineCapacity,
  lineLoginOf,
  lineProfilePatterns,
  lineReplaceIsPositional,
  lineSummary,
  nextLineName,
  normalizeServerUrl,
  parseBackupUrls,
  providerLinesNow,
  storedBackupUrls,
  type IptvLine,
} from "../iptvLineRules";

const NOW = Date.parse("2026-10-16T16:00:00Z");
const line = (over: Partial<IptvLine> = {}): IptvLine => ({
  id: 7,
  name: "Line 2",
  isDefault: false,
  active: true,
  maxStreams: 1,
  viewers: 0,
  expiresUtc: "2026-11-15T23:00:00Z",
  status: "Active",
  ...over,
});

describe("lineProfilePatterns", () => {
  const apply = (url: string, u: string, p: string) => {
    const { search, replace } = lineProfilePatterns(u, p);
    // Dispatcharr turns the JS-style $1 into a Python backreference; the JS form works as-is here.
    return url.replace(new RegExp(search), replace);
  };
  it("swaps the login in both URL shapes a panel hands out", () => {
    expect(apply("http://line.example.cc/live/olduser/oldpass/1234.ts", "u2", "p2")).toBe("http://line.example.cc/live/u2/p2/1234.ts");
    expect(apply("http://line.example.cc:8080/olduser/oldpass/1234", "u2", "p2")).toBe("http://line.example.cc:8080/u2/p2/1234");
    expect(apply("https://x.example/movie/olduser/oldpass/55.mkv", "u2", "p2")).toBe("https://x.example/movie/u2/p2/55.mkv");
  });
  it("matches the synthetic URL Dispatcharr derives the login from", () => {
    expect(apply("http://line.example.cc/live/base/basepw/1234.ts", "u2", "p2")).toContain("/live/u2/p2/1234.ts");
  });
  it("uses a named group, so a login starting with a digit is not read as a backreference", () => {
    // "$1" + "4dad..." becomes Python "\14dad" = group 14, which is what broke
    // the trex line added 2026-10-18. The named form cannot be misread.
    const { replace } = lineProfilePatterns("4dad0abc", "p2");
    expect(replace.startsWith("$<base>")).toBe(true);
    expect(lineReplaceIsPositional(replace)).toBe(false);
    expect(apply("http://x.example/live/old/old/1.ts", "4dad0abc", "p2")).toBe("http://x.example/live/4dad0abc/p2/1.ts");
  });
});

describe("lineReplaceIsPositional", () => {
  it("flags the old $1 form and clears the named form", () => {
    expect(lineReplaceIsPositional("$1u/p/")).toBe(true);
    expect(lineReplaceIsPositional("$<base>u/p/")).toBe(false);
    expect(lineReplaceIsPositional(null)).toBe(false);
  });
});

describe("isLineLogin", () => {
  it("accepts panel-style logins and nothing that could break the rewrite", () => {
    expect(isLineLogin("244d0dd2bc")).toBe(true);
    expect(isLineLogin("user.name@x")).toBe(true);
    expect(isLineLogin("has space")).toBe(false);
    expect(isLineLogin("a/b")).toBe(false);
    expect(isLineLogin("$1")).toBe(false);
    expect(isLineLogin("")).toBe(false);
  });
});

describe("naming and capacity", () => {
  it("names the next line after the ones that exist", () => {
    expect(nextLineName(["trex Default"])).toBe("Line 2");
    expect(nextLineName(["trex Default", "Line 2"])).toBe("Line 3");
    expect(nextLineName(["Default", "line 3"])).toBe("Line 2");
  });
  it("counts connections across working lines only", () => {
    const lines = [line({ id: 1, isDefault: true, name: "Default" }), line(), line({ id: 8, status: "Expired" }), line({ id: 9, active: false })];
    expect(lineCapacity(lines, NOW)).toBe(2);
    expect(lineSummary(lines, NOW)).toBe("2 lines · 2 connections");
    expect(lineSummary([line({ isDefault: true })], NOW)).toBe("1 line · 1 connection");
  });
  it("calls a lapsed or banned line dead", () => {
    expect(isLineDead(line(), NOW)).toBe(false);
    expect(isLineDead(line({ status: "Banned" }), NOW)).toBe(true);
    expect(isLineDead(line({ expiresUtc: "2026-10-01T00:00:00Z" }), NOW)).toBe(true);
  });
  it("says why a line is dead", () => {
    expect(deadReason(line(), NOW)).toBeNull();
    expect(deadReason(line({ status: "Banned" }), NOW)).toBe("banned");
    expect(deadReason(line({ status: "Expired" }), NOW)).toBe("expired");
    expect(deadReason(line({ expiresUtc: "2026-10-01T00:00:00Z" }), NOW)).toBe("expired");
  });
  it("never lists a dead line as one that could be free", () => {
    // trex, 2026-11-19: main login expired 11-15, two extra lines good -- all four read "free".
    const at = Date.parse("2026-11-19T23:00:00Z");
    const rows = providerLinesNow(
      [
        {
          name: "trex",
          lines: [
            line({ id: 5, name: "trex Default", isDefault: true, status: "Expired", expiresUtc: "2026-11-15T23:00:00Z" }),
            line({ id: 7, name: "Line 2", expiresUtc: "2027-04-18T22:00:00Z" }),
          ],
        },
        { name: "strong8k", lines: [line({ id: 6, name: "strong8k Default", isDefault: true, expiresUtc: "2027-04-14T01:15:03Z" })] },
      ],
      at
    );
    expect(rows.map((r) => [r.provider, r.line, r.dead, r.isDefault])).toEqual([
      ["trex", "trex Default", "expired", true],
      ["trex", "Line 2", null, false],
      ["strong8k", "strong8k Default", null, true],
    ]);
  });
  it("warns about a line the way it warns about the provider login", () => {
    expect(lineAlert(line(), NOW)).toBeNull();
    expect(lineAlert(line({ expiresUtc: "2026-10-17T10:00:00Z" }), NOW)?.tone).toBe("warning");
    expect(lineAlert(line({ status: "Expired" }), NOW)?.tone).toBe("danger");
  });
});

describe("a line's own server", () => {
  const apply = (url: string, u: string, p: string, server: string | null) => {
    const { search, replace } = lineProfilePatterns(u, p, server);
    return url.replace(new RegExp(search), replace);
  };

  it("swaps the server as well as the login", () => {
    expect(apply("http://line.trex.cc/live/old/old/1234.ts", "u2", "p2", "http://backup.trex.cc:8080")).toBe(
      "http://backup.trex.cc:8080/live/u2/p2/1234.ts"
    );
    expect(apply("http://line.trex.cc/old/old/1234", "u2", "p2", "http://b.example")).toBe("http://b.example/u2/p2/1234");
    expect(apply("http://line.trex.cc/live/old/old/1.ts", "u2", "p2", null)).toBe("http://line.trex.cc/live/u2/p2/1.ts");
  });

  it("reads back the login and server a rewrite carries", () => {
    const withServer = lineProfilePatterns("4dad0abc", "pw", "http://b.example:8080").replace;
    expect(lineLoginOf(withServer)).toEqual({ serverUrl: "http://b.example:8080", username: "4dad0abc", password: "pw" });
    expect(lineLoginOf(lineProfilePatterns("u2", "p2").replace)).toEqual({ serverUrl: null, username: "u2", password: "p2" });
    expect(lineLoginOf("$1u3/p3/")).toEqual({ serverUrl: null, username: "u3", password: "p3" });
    // The main login's identity rewrite carries no login of its own.
    expect(lineLoginOf("$1")).toBeNull();
    expect(lineLoginOf(null)).toBeNull();
  });

  it("normalizes what is typed to scheme://host[:port]", () => {
    expect(normalizeServerUrl("line.trex.cc")).toBe("http://line.trex.cc");
    expect(normalizeServerUrl(" HTTPS://Line.Trex.cc:8443/player_api.php?x=1 ")).toBe("https://line.trex.cc:8443");
    expect(normalizeServerUrl("ftp://x.example")).toBeNull();
    expect(normalizeServerUrl("http://user:pw@x.example")).toBeNull();
    expect(normalizeServerUrl("")).toBeNull();
  });

  it("takes backups one per line, without duplicates or the line's own server", () => {
    expect(parseBackupUrls("a.example\nhttp://b.example:8080, a.example\n\nhttp://own.example", "http://own.example")).toEqual({
      urls: ["http://a.example", "http://b.example:8080"],
      bad: [],
    });
    expect(parseBackupUrls("ftp://nope b.example").bad).toEqual(["ftp://nope"]);
  });

  it("reads stored backups whatever shape the profile's properties are in", () => {
    expect(storedBackupUrls({ [BACKUP_URLS_KEY]: ["b.example", 7, "ftp://x"], user_info: {} })).toEqual(["http://b.example"]);
    expect(storedBackupUrls(null)).toEqual([]);
    expect(storedBackupUrls({ [BACKUP_URLS_KEY]: "b.example" })).toEqual([]);
  });

  it("says when a provider has no active lines", () => {
    expect(lineSummary([line({ isDefault: true, active: false })])).toBe("No active lines");
  });
});
