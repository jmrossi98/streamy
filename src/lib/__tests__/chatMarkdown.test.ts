import { describe, expect, it } from "vitest";
import type { Tokens } from "marked";
import { lexChat, parseTraceLine, safeHref, splitTrace, traceSummary } from "../chatMarkdown";

describe("lexChat", () => {
  it("parses a GFM table into header and rows", () => {
    const tokens = lexChat("| Option | Cost |\n|---|---:|\n| A | $80 |\n| B | $95 |\n");
    const table = tokens.find((t) => t.type === "table") as Tokens.Table;
    expect(table).toBeTruthy();
    expect(table.header.map((c) => c.text)).toEqual(["Option", "Cost"]);
    expect(table.rows.map((r) => r.map((c) => c.text))).toEqual([
      ["A", "$80"],
      ["B", "$95"],
    ]);
    expect(table.align).toEqual([null, "right"]);
  });

  it("keeps raw HTML as text tokens, never markup", () => {
    const tokens = lexChat('hello <img src=x onerror="alert(1)"> there');
    const para = tokens[0] as Tokens.Paragraph;
    const kinds = para.tokens.map((t) => t.type);
    expect(kinds).toContain("html");
    // The html token is rendered by ChatMessage as its literal text.
    expect(para.tokens.find((t) => t.type === "html")).toMatchObject({ text: '<img src=x onerror="alert(1)">' });
  });

  it("treats a single newline as a line break (breaks: true)", () => {
    const para = lexChat("one\ntwo")[0] as Tokens.Paragraph;
    expect(para.tokens.some((t) => t.type === "br")).toBe(true);
  });

  it("parses lists, headings and inline styling", () => {
    const tokens = lexChat("## Options\n- **bold** and `code`\n- [link](https://example.com)\n");
    expect(tokens.map((t) => t.type)).toEqual(["heading", "list"]);
    const list = tokens[1] as Tokens.List;
    expect(list.items).toHaveLength(2);
  });
});

describe("safeHref", () => {
  it("allows http(s) and mailto only", () => {
    expect(safeHref("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,hi")).toBeNull();
    expect(safeHref("/relative")).toBeNull();
  });
});

describe("trace lines", () => {
  it("recognises the tool loop's progress lines", () => {
    expect(parseTraceLine("> searched `T-Mobile plans 2026`")).toEqual({ verb: "searched", arg: "T-Mobile plans 2026", failed: false });
    expect(parseTraceLine("> searched `nothing here` (no results)")).toEqual({ verb: "searched", arg: "nothing here", failed: true });
    expect(parseTraceLine("> read https://example.com/page (failed)")).toEqual({ verb: "read", arg: "https://example.com/page", failed: true });
    expect(parseTraceLine("> ran `docker ps`")).toEqual({ verb: "ran", arg: "docker ps", failed: false });
    expect(parseTraceLine("> the lookup stopped early: timeout")).toEqual({ verb: "the lookup stopped early", arg: "timeout", failed: false });
  });

  it("leaves ordinary blockquotes to markdown", () => {
    expect(parseTraceLine("> A quote from the page")).toBeNull();
    expect(parseTraceLine("searched `x`")).toBeNull();
  });

  it("splits a reply into an activity run and the answer", () => {
    const chunks = splitTrace("> searched `a`\n> read https://x.y/z\n\nShort answer: **yes**.\n\n> real quote\n");
    expect(chunks.map((c) => c.kind)).toEqual(["trace", "markdown"]);
    expect(chunks[0]).toMatchObject({ lines: [{ verb: "searched" }, { verb: "read" }] });
    expect((chunks[1] as { text: string }).text).toContain("> real quote");
  });

  it("summarises the run", () => {
    const lines = splitTrace("> searched `a`\n> searched `b`\n> read https://x/1\n> ran `uptime`\n")[0];
    expect(lines.kind).toBe("trace");
    if (lines.kind === "trace") expect(traceSummary(lines.lines)).toBe("Searched 2 times · read 1 page · ran 1 command");
  });
});
