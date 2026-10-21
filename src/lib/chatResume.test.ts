import { describe, expect, it } from "vitest";
import { mergeConcurrentTurns, normalizeTurns, type ChatTurn } from "./chatSessionRules";
import { isClaudeCodeSessionKey, listClaudeCodeSessions, parseClaudeCodeNote } from "./claudeCodeNoteRules";
import { parseBridgeRequest, unseenTurns } from "./chatBridgeRules";
import { renderChatNote } from "./sharedVaultRules";

const u = (content: string, via?: "claude-code"): ChatTurn => ({ role: "user", content, ...(via ? { via } : {}) });
const a = (content: string, via?: "claude-code"): ChatTurn => ({ role: "assistant", content, ...(via ? { via } : {}) });

describe("normalizeTurns keeps where a turn happened", () => {
  it("keeps via=claude-code and drops anything else in that field", () => {
    expect(normalizeTurns([{ role: "user", content: "x", via: "claude-code" }, { role: "user", content: "y", via: "evil" }])).toEqual([
      u("x", "claude-code"),
      u("y"),
    ]);
  });
});

describe("mergeConcurrentTurns", () => {
  const stored = [u("q1"), a("a1")];

  it("replaces the transcript when nothing was added elsewhere", () => {
    const edited = [u("q1 edited"), a("a1")];
    expect(mergeConcurrentTurns(stored, edited, 2)).toEqual(edited);
  });

  it("replaces when the client sends no base (an older panel)", () => {
    expect(mergeConcurrentTurns(stored, [u("x")], null)).toEqual([u("x")]);
  });

  it("keeps turns Claude Code appended and puts the panel's new ones after them", () => {
    const withClaude = [...stored, u("cc q", "claude-code"), a("cc a", "claude-code")];
    const panel = [...stored, u("q2")];
    expect(mergeConcurrentTurns(withClaude, panel, 2)).toEqual([...withClaude, u("q2")]);
  });

  it("refuses when the panel changed history that something else appended to", () => {
    const withClaude = [...stored, a("cc a", "claude-code")];
    expect(mergeConcurrentTurns(withClaude, [u("q1 edited"), a("a1"), u("q2")], 2)).toBeNull();
  });

  it("refuses an impossible base", () => {
    expect(mergeConcurrentTurns(stored, [u("q1")], 5)).toBeNull();
    expect(mergeConcurrentTurns([...stored, a("x")], [u("q1")], 2)).toBeNull();
  });
});

const NOTE = `---
source: claude-code
machine: laptop
project: projects
session: 16ebe386-e2dd-44c5-b5a9-efb3ea2cda3c
title: "Home, movies, TV tab row variation"
started: 2026-10-18T23:34:34.486Z
---

# Home, movies, TV tab row variation

A Claude Code session on laptop, condensed. Read-only.

### User · 2026-10-18 23:35 UTC

can we add more variation for the rows?

### Claude (claude-fable-5-1) · 2026-10-18 23:35 UTC

I'll look at how rows are built.

> Bash: Find row-building code

Done.

### Context summary (written when the session was compacted) · 2026-10-19 03:10 UTC

Earlier we added rows.

### User · 2026-10-19 03:11 UTC

thanks
`;

describe("parseClaudeCodeNote", () => {
  it("reads the session id, title, and turns, all marked as from Claude Code", () => {
    const parsed = parseClaudeCodeNote(NOTE);
    expect(parsed.sessionId).toBe("16ebe386-e2dd-44c5-b5a9-efb3ea2cda3c");
    expect(parsed.title).toBe("Home, movies, TV tab row variation");
    expect(parsed.turns.map((t) => t.role)).toEqual(["user", "assistant", "assistant", "user"]);
    expect(parsed.turns.every((t) => t.via === "claude-code")).toBe(true);
    expect(parsed.turns[1].content).toBe("I'll look at how rows are built.\n\n> Bash: Find row-building code\n\nDone.");
    expect(parsed.turns[2].content).toMatch(/^\*\*Summary of the earlier conversation\*\*\n\nEarlier we added rows\.$/);
    expect(parsed.turns[3].content).toBe("thanks");
  });

  it("copes with a note without front matter", () => {
    expect(parseClaudeCodeNote("### User · x\n\nhi\n").turns).toEqual([u("hi", "claude-code")]);
  });
});

describe("listClaudeCodeSessions", () => {
  const dir = "main/ai/chats/claude-code";
  const entries = [
    { path: `${dir}/laptop/2026-10-18-home-movies-tv-16ebe386.md`, isDir: false, modified: "Tue, 21 Oct 2026 02:00:00 GMT" },
    { path: `${dir}/laptop/2026-10-18-home-movies-tv-16ebe386-part2.md`, isDir: false, modified: "Tue, 21 Oct 2026 03:00:00 GMT" },
    { path: `${dir}/desktop/2026-10-20-kh-mod-aaaabbbb.md`, isDir: false, modified: "Mon, 20 Oct 2026 01:00:00 GMT" },
    { path: `${dir}/laptop/notes.md`, isDir: false, modified: null },
    { path: `${dir}/laptop/`, isDir: true, modified: null },
    { path: "main/ai/chats/streamy/2026-10-21-x-12345678.md", isDir: false, modified: null },
  ];

  it("groups parts in order, newest session first, and ignores other files", () => {
    const list = listClaudeCodeSessions(entries);
    expect(list.map((s) => s.key)).toEqual(["laptop/2026-10-18-home-movies-tv-16ebe386", "desktop/2026-10-20-kh-mod-aaaabbbb"]);
    expect(list[0].parts).toEqual([entries[0].path, entries[1].path]);
    expect(list[0].title).toBe("Home movies tv");
    expect(list[0].sid8).toBe("16ebe386");
    expect(list[0].modified).toBe(Date.parse("Tue, 21 Oct 2026 03:00:00 GMT"));
  });

  it("orders parts by number even when listed out of order", () => {
    const list = listClaudeCodeSessions([entries[1], entries[0]]);
    expect(list[0].parts).toEqual([entries[0].path, entries[1].path]);
  });
});

describe("isClaudeCodeSessionKey", () => {
  it("accepts listing keys and rejects anything path-like", () => {
    expect(isClaudeCodeSessionKey("laptop/2026-10-18-home-movies-tv-16ebe386")).toBe(true);
    expect(isClaudeCodeSessionKey("../2026-10-18-x-16ebe386")).toBe(false);
    expect(isClaudeCodeSessionKey("laptop/sub/2026-10-18-x-16ebe386")).toBe(false);
    expect(isClaudeCodeSessionKey("laptop/2026-10-18-x-16ebe386.md")).toBe(false);
    expect(isClaudeCodeSessionKey(42)).toBe(false);
  });
});

describe("parseBridgeRequest", () => {
  it("accepts each op with valid fields", () => {
    expect(parseBridgeRequest({ op: "list" })).toEqual({ op: "list", limit: 20 });
    expect(parseBridgeRequest({ op: "get", id: "cmvhgpwp5000fjb3kn6kpstcw", from: 3 })).toEqual({
      op: "get",
      id: "cmvhgpwp5000fjb3kn6kpstcw",
      from: 3,
    });
    expect(parseBridgeRequest({ op: "link", id: "cmvhgpwp5000", claudeSessionId: "16EBE386-E2DD" })).toEqual({
      op: "link",
      id: "cmvhgpwp5000",
      claudeSessionId: "16ebe386-e2dd",
    });
  });

  it("marks appended turns as from Claude Code, whatever was sent", () => {
    const req = parseBridgeRequest({ op: "append", id: "cmvhgpwp5000", turns: [{ role: "user", content: "hi" }] });
    expect(req).toEqual({ op: "append", id: "cmvhgpwp5000", turns: [u("hi", "claude-code")] });
  });

  it("refuses bad input", () => {
    expect(parseBridgeRequest(null)).toBe("body must be a JSON object");
    expect(parseBridgeRequest({ op: "drop-tables" })).toBe("unknown op");
    expect(parseBridgeRequest({ op: "get", id: "../x" })).toBe("get needs an id");
    expect(parseBridgeRequest({ op: "link", id: "cmvhgpwp5000", claudeSessionId: "'; rm" })).toMatch(/needs/);
    expect(parseBridgeRequest({ op: "append", id: "cmvhgpwp5000", turns: [] })).toBe("append needs turns");
    expect(parseBridgeRequest({ op: "find", query: "  " })).toBe("find needs a query");
  });

  it("clamps numbers", () => {
    expect(parseBridgeRequest({ op: "list", limit: 10_000 })).toEqual({ op: "list", limit: 200 });
    expect(parseBridgeRequest({ op: "seen", id: "cmvhgpwp5000", seen: -4 })).toEqual({ op: "seen", id: "cmvhgpwp5000", seen: 0 });
  });
});

describe("unseenTurns", () => {
  it("is what came after the last seen count, minus Claude Code's own turns", () => {
    const turns = [u("old"), a("old"), u("panel q"), a("panel a"), u("cc q", "claude-code"), a("cc a", "claude-code")];
    expect(unseenTurns(turns, 2)).toEqual([u("panel q"), a("panel a")]);
    expect(unseenTurns(turns, 6)).toEqual([]);
  });
});

describe("renderChatNote with Claude Code turns", () => {
  it("labels where each turn happened and records the linked session", () => {
    const md = renderChatNote({
      id: "abc123456789",
      title: "Rows",
      backend: "claude",
      author: "jaker",
      createdAt: new Date("2026-10-21T00:00:00Z"),
      updatedAt: new Date("2026-10-21T00:00:00Z"),
      claudeSessionId: "16ebe386-e2dd",
      turns: [u("cc q", "claude-code"), a("cc a", "claude-code"), u("panel q"), a("panel a")],
    });
    expect(md).toContain('claude-session: "16ebe386-e2dd"');
    expect(md).toContain("### jaker (in Claude Code)\n\ncc q");
    expect(md).toContain("### Claude Code\n\ncc a");
    expect(md).toContain("### jaker\n\npanel q");
    expect(md).toContain("### Assistant\n\npanel a");
  });
});
