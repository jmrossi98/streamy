import { describe, expect, it } from "vitest";
import { isCareerQuestion, systemPromptFor } from "./chatLimits";
import { chunkNote, isClaudeMemoryPath, isResumePath, splitVaultHits } from "./vaultIndexRules";
import type { Hit } from "./docsRetrieval";

describe("isCareerQuestion", () => {
  it("catches questions about the admin's own career", () => {
    for (const q of [
      "can you give me a summary of my job experience?",
      "what's on my resume",
      "rewrite my CV summary",
      "what skills do I list on my résumé?",
      "where have I worked?",
      "what did I accomplish at capital one",
      "help me prep my interview for Stripe",
      "summarize my work history",
    ]) {
      expect(isCareerQuestion(q), q).toBe(true);
    }
  });
  it("leaves stack questions alone", () => {
    for (const q of ["is jellyfin up?", "why is sonarr stuck on the cv episode", "which users streamed recently?", "disk space"]) {
      expect(isCareerQuestion(q), q).toBe(false);
    }
  });
});

describe("the system prompt", () => {
  it("tells every backend it can read the vault", () => {
    for (const b of ["local", "open", "claude"] as const) expect(systemPromptFor(b)).toMatch(/Obsidian vault/);
  });
});

describe("vault paths", () => {
  it("recognises Claude Code memory and resume folders", () => {
    expect(isClaudeMemoryPath("claude-memory/laptop/projects/feedback.md")).toBe(true);
    expect(isClaudeMemoryPath("Homelab/claude-memory.md")).toBe(false);
    expect(isResumePath("main/resume/jakob_rossi_resume.docx")).toBe(true);
    expect(isResumePath("resume/notes.md")).toBe(true);
    expect(isResumePath("Homelab/Overview.md")).toBe(false);
  });
  it("titles a Word or PDF chunk without its extension", () => {
    expect(chunkNote("main/resume/jakob_rossi_resume.docx", "EXPERIENCE\nEngineer")[0].title).toBe("jakob_rossi_resume");
  });
});

describe("splitVaultHits", () => {
  const hit = (path: string): Hit => ({ chunk: { id: path, repo: "vault", path, title: path, text: "x" }, score: 5 });
  const hits = [hit("Homelab/Overview.md"), hit("claude-memory/desktop/x/memory/a.md"), hit("main/resume/r.docx")];
  it("separates Claude Code memory from the admin's notes", () => {
    const { notes, memory } = splitVaultHits(hits, { dropResume: false });
    expect(notes.map((h) => h.chunk.path)).toEqual(["Homelab/Overview.md", "main/resume/r.docx"]);
    expect(memory.map((h) => h.chunk.path)).toEqual(["claude-memory/desktop/x/memory/a.md"]);
  });
  it("drops resume hits when the whole resume is already in the prompt", () => {
    expect(splitVaultHits(hits, { dropResume: true }).notes.map((h) => h.chunk.path)).toEqual(["Homelab/Overview.md"]);
  });
});
