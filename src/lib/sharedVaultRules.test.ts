import { describe, expect, it } from "vitest";
import {
  buildRecentChatsBlock,
  chatNoteLabel,
  chatNotePath,
  chatNoteSuffix,
  isRecentChatQuestion,
  isWritableVaultPath,
  MAX_CHAT_NOTE_CHARS,
  newestChatNotes,
  renderChatNote,
  slugify,
  vaultVoice,
} from "./sharedVaultRules";
import { splitVaultHits } from "./vaultIndexRules";
import type { Hit } from "./docsRetrieval";

describe("vaultVoice", () => {
  it("tells the admin's notes from model memory and past chats", () => {
    expect(vaultVoice("main/resume/capital-one/notes.md")).toBe("note");
    expect(vaultVoice("Homelab/Overview.md")).toBe("note");
    expect(vaultVoice("main/ai/memory/laptop/projects/projects/MEMORY.md")).toBe("memory");
    expect(vaultVoice("main/ai/README.md")).toBe("memory");
    expect(vaultVoice("claude-memory/laptop/CLAUDE.md")).toBe("memory");
    expect(vaultVoice("main/ai/chats/streamy/2026-10-21-kafka-4kpstcw0.md")).toBe("chat");
    expect(vaultVoice("main/ai/chats/claude-code/laptop/2026-10-20-x.md")).toBe("chat");
  });

  it("does not match a folder that merely starts with the same letters", () => {
    expect(vaultVoice("main/aim/notes.md")).toBe("note");
    expect(vaultVoice("claude-memory-old/notes.md")).toBe("note");
  });
});

describe("isWritableVaultPath", () => {
  it("allows only Markdown directly in Streamy's chat folder", () => {
    expect(isWritableVaultPath("main/ai/chats/streamy/2026-10-21-a-12345678.md")).toBe(true);
    expect(isWritableVaultPath("main/ai/chats/streamy/sub/a.md")).toBe(false);
    expect(isWritableVaultPath("main/ai/chats/streamy/a.txt")).toBe(false);
    expect(isWritableVaultPath("main/ai/chats/claude-code/laptop/a.md")).toBe(false);
    expect(isWritableVaultPath("main/resume/notes.md")).toBe(false);
    expect(isWritableVaultPath("main/ai/chats/streamy/../../resume/notes.md")).toBe(false);
    expect(isWritableVaultPath("/main/ai/chats/streamy/a.md")).toBe(false);
  });
});

describe("chat note naming", () => {
  it("slugs titles to lowercase words and dashes", () => {
    expect(slugify("What are the best books written by Franz Kafka?")).toBe("what-are-the-best-books-written-by-franz-kafka");
    expect(slugify("Café — résumé!!")).toBe("cafe-resume");
    expect(slugify("???")).toBe("chat");
    expect(slugify("a".repeat(80)).length).toBe(50);
  });

  it("names a note by day, title and the chat id's tail", () => {
    const path = chatNotePath({
      id: "cmvhgpwp5000fjb3kn6kpstcw",
      title: "Kafka books",
      createdAt: new Date("2026-10-21T01:57:50Z"),
    });
    expect(path).toBe("main/ai/chats/streamy/2026-10-21-kafka-books-n6kpstcw.md");
    expect(path.endsWith(chatNoteSuffix("cmvhgpwp5000fjb3kn6kpstcw"))).toBe(true);
    expect(isWritableVaultPath(path)).toBe(true);
  });
});

describe("renderChatNote", () => {
  const base = {
    id: "abc123456789",
    title: 'Why "searxng" went away',
    backend: "claude",
    author: "jaker",
    createdAt: new Date("2026-10-21T01:57:50Z"),
    updatedAt: new Date("2026-10-21T02:02:16Z"),
  };

  it("writes front matter, the title, and each turn under its speaker", () => {
    const md = renderChatNote({
      ...base,
      turns: [
        { role: "user", content: "why did we remove it?" },
        { role: "assistant", content: "It was stopped by hand." },
      ],
    });
    expect(md.startsWith("---\nsource: streamy-admin-chat\n")).toBe(true);
    expect(md).toContain('title: "Why \\"searxng\\" went away"');
    expect(md).toContain('model-slot: "claude"');
    expect(md).toContain("turns: 2");
    expect(md).toContain("### jaker\n\nwhy did we remove it?");
    expect(md).toContain("### Assistant\n\nIt was stopped by hand.");
    expect(md).not.toContain("left out for length");
  });

  it("drops the oldest turns past the size cap, and says so", () => {
    const big = "x".repeat(70_000);
    const turns = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `${i} ${big}` }) as const);
    const md = renderChatNote({ ...base, turns: [...turns] });
    expect(md.length).toBeLessThanOrEqual(MAX_CHAT_NOTE_CHARS);
    expect(md).toMatch(/\[\d earlier turns? left out for length\]/);
    expect(md).toContain(`5 ${big.slice(0, 10)}`);
    expect(md).not.toContain(`0 ${big.slice(0, 10)}`);
  });
});

describe("isRecentChatQuestion", () => {
  it.each([
    "can you read the most recent admin chat?",
    "what did we talk about last time",
    "summarize my last conversation",
    "what was Claude Code working on today?",
    "what did you fix yesterday",
    "show the previous session",
  ])("matches %s", (q) => expect(isRecentChatQuestion(q)).toBe(true));

  it.each(["how much has newshosting been used?", "why is sonarr slow", "best books by kafka"])(
    "leaves %s to normal search",
    (q) => expect(isRecentChatQuestion(q)).toBe(false)
  );
});

describe("newestChatNotes", () => {
  const entries = [
    { path: "main/ai/chats/streamy/2026-10-20-old-aaaaaaaa.md", isDir: false, modified: "Mon, 20 Oct 2026 10:00:00 GMT" },
    { path: "main/ai/chats/streamy/2026-10-21-current-bbbbbbbb.md", isDir: false, modified: "Tue, 21 Oct 2026 03:00:00 GMT" },
    { path: "main/ai/chats/claude-code/laptop/2026-10-21-sync-cccccccc.md", isDir: false, modified: "Tue, 21 Oct 2026 02:00:00 GMT" },
    { path: "main/ai/chats/claude-code/laptop/", isDir: true, modified: null },
    { path: "main/ai/memory/laptop/MEMORY.md", isDir: false, modified: "Tue, 21 Oct 2026 04:00:00 GMT" },
  ];

  it("lists chats newest first, skipping folders, memory, and the chat being answered", () => {
    const list = newestChatNotes(entries, "xxxxbbbbbbbb", 5);
    expect(list.map((c) => c.path)).toEqual([
      "main/ai/chats/claude-code/laptop/2026-10-21-sync-cccccccc.md",
      "main/ai/chats/streamy/2026-10-20-old-aaaaaaaa.md",
    ]);
    expect(list[0].label).toBe("Claude Code on laptop");
    expect(list[1].label).toBe("Streamy admin chat");
  });

  it("respects the limit", () => {
    expect(newestChatNotes(entries, null, 1).map((c) => c.path)).toEqual([
      "main/ai/chats/streamy/2026-10-21-current-bbbbbbbb.md",
    ]);
  });
});

describe("chatNoteLabel", () => {
  it("names the source from the folder", () => {
    expect(chatNoteLabel("main/ai/chats/claude-code/desktop/x.md")).toBe("Claude Code on desktop");
    expect(chatNoteLabel("main/ai/chats/streamy/x.md")).toBe("Streamy admin chat");
    expect(chatNoteLabel("main/ai/chats/chatgpt/x.md")).toBe("ChatGPT chat");
  });
});

describe("buildRecentChatsBlock", () => {
  const ref = { path: "main/ai/chats/streamy/a.md", modified: Date.parse("2026-10-21T02:02:00Z"), label: "Streamy admin chat" };

  it("is empty with no chats", () => {
    expect(buildRecentChatsBlock([], null, 1000)).toBeNull();
  });

  it("lists chats and keeps the end of a long newest one", () => {
    const text = `START ${"y".repeat(5000)} END`;
    const block = buildRecentChatsBlock([ref], { ref, text }, 2000)!;
    expect(block).toContain("2026-10-21 02:02 UTC · Streamy admin chat · main/ai/chats/streamy/a.md");
    expect(block).toContain("[... start cut for length]");
    expect(block).toContain("END");
    expect(block).not.toContain("START");
    expect(block.length).toBeLessThan(2100);
  });
});

describe("splitVaultHits with chats", () => {
  const hit = (path: string): Hit => ({ chunk: { id: path, repo: "vault", path, title: path, text: "t" }, score: 1 });

  it("separates chats and drops the current chat's own copy", () => {
    const { notes, memory, chats } = splitVaultHits(
      [
        hit("Homelab/Overview.md"),
        hit("main/ai/memory/laptop/a.md"),
        hit("main/ai/chats/streamy/2026-10-21-a-bbbbbbbb.md"),
        hit("main/ai/chats/claude-code/laptop/2026-10-21-b-cccccccc.md"),
      ],
      { dropResume: false, currentChatSuffix: "-bbbbbbbb.md" }
    );
    expect(notes.map((h) => h.chunk.path)).toEqual(["Homelab/Overview.md"]);
    expect(memory.map((h) => h.chunk.path)).toEqual(["main/ai/memory/laptop/a.md"]);
    expect(chats.map((h) => h.chunk.path)).toEqual(["main/ai/chats/claude-code/laptop/2026-10-21-b-cccccccc.md"]);
  });
});
