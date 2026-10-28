import { describe, expect, it } from "vitest";
import { importSource, isClaudeAppImport, listClaudeCodeSessions, parseClaudeCodeNote, storedSessionId } from "../claudeCodeNoteRules";
import type { VaultEntry } from "../vaultRules";

const entry = (path: string, modified = "2026-10-24T20:00:00Z"): VaultEntry => ({ path, isDir: false, modified, size: 10 } as VaultEntry);

describe("listClaudeCodeSessions", () => {
  it("lists Claude Code sessions per machine and Claude app chats under claude-app", () => {
    const refs = listClaudeCodeSessions([
      entry("main/ai/chats/claude-code/laptop/2026-10-24-playback-stalled-4360bf8f.md", "2026-10-24T21:00:00Z"),
      entry("main/ai/chats/claude-code/laptop/2026-10-18-home-rows-16ebe386.md", "2026-10-18T10:00:00Z"),
      entry("main/ai/chats/claude-code/laptop/2026-10-18-home-rows-16ebe386-part2.md", "2026-10-18T11:00:00Z"),
      entry("main/ai/chats/claude-app/2026-10-20-mobile-plan-costco-9b2f1c3d.md", "2026-10-20T12:00:00Z"),
      entry("main/ai/chats/streamy/2026-10-21-something-4kpstcw0.md"),
      entry("main/ai/chats/claude-app/nested/2026-10-20-ignored-9b2f1c3e.md"),
    ]);
    expect(refs.map((r) => r.key)).toEqual([
      "laptop/2026-10-24-playback-stalled-4360bf8f",
      "claude-app/2026-10-20-mobile-plan-costco-9b2f1c3d",
      "laptop/2026-10-18-home-rows-16ebe386",
    ]);
    expect(refs[1].machine).toBe("claude-app");
    expect(refs[1].title).toBe("Mobile plan costco");
    expect(refs[2].parts).toHaveLength(2);
  });

  it("lists ChatGPT chats under chatgpt", () => {
    const refs = listClaudeCodeSessions([
      entry("main/ai/chats/chatgpt/2026-10-26-trip-packing-list-6a1b2c3d.md", "2026-10-26T09:00:00Z"),
      entry("main/ai/chats/chatgpt/2026-10-26-trip-packing-list-6a1b2c3d-part2.md", "2026-10-26T09:30:00Z"),
      entry("main/ai/chats/claude-app/2026-10-20-mobile-plan-costco-9b2f1c3d.md", "2026-10-20T12:00:00Z"),
      entry("main/ai/chats/chatgpt/nested/2026-10-26-ignored-6a1b2c3e.md"),
    ]);
    expect(refs.map((r) => r.key)).toEqual([
      "chatgpt/2026-10-26-trip-packing-list-6a1b2c3d",
      "claude-app/2026-10-20-mobile-plan-costco-9b2f1c3d",
    ]);
    expect(refs[0].machine).toBe("chatgpt");
    expect(refs[0].title).toBe("Trip packing list");
    expect(refs[0].parts).toHaveLength(2);
  });
});

describe("stored session ids", () => {
  it("prefixes Claude app imports so the bridge leaves them alone", () => {
    expect(storedSessionId("laptop", "4360bf8f-aaaa")).toBe("4360bf8f-aaaa");
    expect(storedSessionId("claude-app", "9b2f1c3d-bbbb")).toBe("app-9b2f1c3d-bbbb");
    expect(isClaudeAppImport("app-9b2f1c3d-bbbb")).toBe(true);
    expect(isClaudeAppImport("4360bf8f-aaaa")).toBe(false);
    expect(isClaudeAppImport(null)).toBe(false);
  });

  it("prefixes ChatGPT imports so the bridge leaves them alone too", () => {
    expect(storedSessionId("chatgpt", "6a1b2c3d-cccc")).toBe("app-gpt-6a1b2c3d-cccc");
    expect(isClaudeAppImport("app-gpt-6a1b2c3d-cccc")).toBe(true);
  });

  it("names the app an import came from", () => {
    expect(importSource("app-gpt-6a1b2c3d-cccc")).toBe("chatgpt");
    expect(importSource("app-9b2f1c3d-bbbb")).toBe("claude-app");
    expect(importSource("4360bf8f-aaaa")).toBeNull();
    expect(importSource(null)).toBeNull();
  });
});

describe("parseClaudeCodeNote", () => {
  const note = (source: string) =>
    [
      "---",
      `source: ${source}`,
      "machine: claude-app",
      "session: 9b2f1c3d-1111-2222-3333-444444444444",
      'title: "Mobile plan"',
      "---",
      "",
      "# Mobile plan",
      "",
      "### User · 2026-10-20 12:00 UTC",
      "",
      "Which plan?",
      "",
      "### Claude (claude-opus-5-5) · 2026-10-20 12:01 UTC",
      "",
      "Essentials Saver.",
      "",
    ].join("\n");

  it("marks turns from a Claude app export as such", () => {
    const parsed = parseClaudeCodeNote(note("claude-app"));
    expect(parsed.title).toBe("Mobile plan");
    expect(parsed.sessionId).toBe("9b2f1c3d-1111-2222-3333-444444444444");
    expect(parsed.turns).toEqual([
      { role: "user", content: "Which plan?", via: "claude-app" },
      { role: "assistant", content: "Essentials Saver.", via: "claude-app" },
    ]);
  });

  it("marks turns from a ChatGPT export as such, with ChatGPT headings", () => {
    const md = note("chatgpt").replace("### Claude (claude-opus-5-5) ·", "### ChatGPT (gpt-5) ·");
    expect(parseClaudeCodeNote(md).turns).toEqual([
      { role: "user", content: "Which plan?", via: "chatgpt" },
      { role: "assistant", content: "Essentials Saver.", via: "chatgpt" },
    ]);
  });

  it("marks Claude Code turns as before", () => {
    expect(parseClaudeCodeNote(note("claude-code")).turns.every((t) => t.via === "claude-code")).toBe(true);
  });
});
