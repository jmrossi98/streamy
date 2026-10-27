import { describe, expect, it } from "vitest";
import {
  APP_LOG_LINE_MAX_CHARS,
  filterAppLogs,
  LogRing,
  makeEntry,
  parseAppLogQuery,
  redactLogLine,
  type AppLogEntry,
} from "../appLogRules";

const at = (s: number) => new Date(Date.UTC(2026, 9, 27, 10, 0, s));

describe("LogRing", () => {
  it("keeps the newest lines, oldest first", () => {
    const r = new LogRing(3);
    for (let i = 0; i < 5; i++) r.push(makeEntry("log", `line ${i}`, at(i)));
    expect(r.length).toBe(3);
    expect(r.toArray().map((e) => e.msg)).toEqual(["line 2", "line 3", "line 4"]);
  });
  it("is empty to start", () => {
    expect(new LogRing(3).toArray()).toEqual([]);
  });
});

describe("redactLogLine", () => {
  it("removes bearer tokens", () => {
    expect(redactLogLine("Authorization: Bearer abc.def-ghi_12345")).not.toContain("abc.def");
  });
  it("removes key=value and JSON secrets", () => {
    const out = redactLogLine('GET /x?api_key=SECRET1 token=SECRET2 password: hunter2 {"apikey":"SECRET3"}');
    expect(out).not.toMatch(/SECRET1|SECRET2|hunter2|SECRET3/);
  });
  it("removes long hex and base64 keys and provider keys", () => {
    expect(redactLogLine("key 0123456789abcdef0123456789abcdef here")).toBe("key [redacted] here");
    expect(redactLogLine("got aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3jL5nP7rT9 ok")).toBe("got [redacted] ok");
    expect(redactLogLine("sk-ant-api03-abcdefghijklmnopqrstu")).toBe("[redacted]");
  });
  it("leaves ordinary lines, paths and kebab-case names alone", () => {
    const line = "[skills] GET /api/admin/skills/runs/20261027-101500-ab12/permission 200 in 12ms streamy-run-replies-2026-10-27";
    expect(redactLogLine(line)).toBe(line);
  });
});

describe("makeEntry", () => {
  it("cuts long lines", () => {
    const e = makeEntry("error", "x ".repeat(APP_LOG_LINE_MAX_CHARS), at(0));
    expect(e.msg.length).toBeLessThan(APP_LOG_LINE_MAX_CHARS + 20);
    expect(e).toMatchObject({ level: "error", t: "2026-10-27T10:00:00.000Z" });
  });
});

describe("parseAppLogQuery", () => {
  const q = (s: string) => parseAppLogQuery(new URLSearchParams(s));
  it("defaults", () => {
    expect(q("")).toEqual({ ok: true, query: { since: null, grep: null, level: null, limit: 200 } });
  });
  it("reads each parameter", () => {
    expect(q("since=2026-10-27T10:00:00Z&grep=Skill&level=warn&limit=5")).toEqual({
      ok: true,
      query: { since: "2026-10-27T10:00:00.000Z", grep: "Skill", level: "warn", limit: 5 },
    });
  });
  it("refuses bad values", () => {
    expect(q("since=yesterday").ok).toBe(false);
    expect(q("level=debug").ok).toBe(false);
    expect(q("limit=0").ok).toBe(false);
    expect(q("limit=1001").ok).toBe(false);
    expect(q("limit=2.5").ok).toBe(false);
  });
});

describe("filterAppLogs", () => {
  const entries: AppLogEntry[] = [
    makeEntry("log", "server started", at(0)),
    makeEntry("warn", "Slow Sonarr read", at(1)),
    makeEntry("error", "sonarr timeout", at(2)),
    makeEntry("info", "poll ok", at(3)),
  ];
  const base = { since: null, grep: null, level: null, limit: 200 } as const;
  it("level warn includes errors; level error only errors", () => {
    expect(filterAppLogs(entries, { ...base, level: "warn" }).map((e) => e.msg)).toEqual(["Slow Sonarr read", "sonarr timeout"]);
    expect(filterAppLogs(entries, { ...base, level: "error" }).map((e) => e.msg)).toEqual(["sonarr timeout"]);
  });
  it("grep is case-insensitive", () => {
    expect(filterAppLogs(entries, { ...base, grep: "SONARR" })).toHaveLength(2);
  });
  it("since is exclusive", () => {
    expect(filterAppLogs(entries, { ...base, since: at(1).toISOString() }).map((e) => e.msg)).toEqual(["sonarr timeout", "poll ok"]);
  });
  it("limit keeps the newest, oldest first", () => {
    expect(filterAppLogs(entries, { ...base, limit: 2 }).map((e) => e.msg)).toEqual(["sonarr timeout", "poll ok"]);
  });
});
