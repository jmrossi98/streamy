import { describe, it, expect } from "vitest";
import {
  isLineDead,
  isLineLogin,
  lineAlert,
  lineCapacity,
  lineProfilePatterns,
  lineReplaceIsPositional,
  lineSummary,
  nextLineName,
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
    expect(lineCapacity(lines)).toBe(2);
    expect(lineSummary(lines)).toBe("2 lines · 2 connections");
    expect(lineSummary([line({ isDefault: true })])).toBe("1 line · 1 connection");
  });
  it("calls a lapsed or banned line dead", () => {
    expect(isLineDead(line())).toBe(false);
    expect(isLineDead(line({ status: "Banned" }))).toBe(true);
    expect(isLineDead(line({ expiresUtc: "2026-10-01T00:00:00Z" }))).toBe(true);
  });
  it("warns about a line the way it warns about the provider login", () => {
    expect(lineAlert(line(), NOW)).toBeNull();
    expect(lineAlert(line({ expiresUtc: "2026-10-17T10:00:00Z" }), NOW)?.tone).toBe("warning");
    expect(lineAlert(line({ status: "Expired" }), NOW)?.tone).toBe("danger");
  });
});
