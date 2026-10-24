/**
 * Markdown in assistant replies, as data: the prose between code fences is
 * tokenised with marked's lexer and ChatMessage renders the tokens as React
 * elements. No HTML string is ever produced, so nothing a model echoes back
 * from a web page can become markup -- an `<img onerror>` in a reply is
 * text with angle brackets in it.
 *
 * Pure, so it tests without a browser. Code fences are still split off by
 * chatSegments.splitMessage first: that keeps the streaming-aware "open
 * block" behaviour and the copy button exactly as they were.
 */
import { Marked, type Token } from "marked";

const marked = new Marked({
  gfm: true,
  // A single newline is a line break. Models write lists and short lines
  // that way constantly, and the panel showed them that way before it
  // rendered markdown at all; collapsing them now would read as a regression.
  breaks: true,
});

export function lexChat(md: string): Token[] {
  return marked.lexer(md);
}

/** A link target the panel will follow: http(s) or mailto, nothing else. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  return /^(https?:\/\/|mailto:)/i.test(h) ? h : null;
}

/**
 * A line the tool loop wrote while it worked ("> searched `x`", "> read
 * https://...", "> ran `cmd`", "> the lookup stopped early: ..."). Shown as a
 * muted activity line, apart from the answer, the way other chat apps show
 * their tool use.
 */
export type TraceLine = { verb: string; arg: string; failed: boolean };

const TRACE = /^>\s+(searched|read|ran|the lookup stopped early:|search is resting[^\n]*?)\s*(.*)$/;

export function parseTraceLine(line: string): TraceLine | null {
  const m = TRACE.exec(line.trim());
  if (!m) return null;
  let arg = m[2].trim();
  let failed = false;
  const tail = /\s\((no results|failed)\)$/.exec(arg);
  if (tail) {
    failed = true;
    arg = arg.slice(0, tail.index);
  }
  return { verb: m[1].replace(/:$/, ""), arg: arg.replace(/^`(.*)`$/, "$1"), failed };
}

export type ProseChunk = { kind: "markdown"; text: string } | { kind: "trace"; lines: TraceLine[] };

/** Prose split into runs of activity lines and runs of markdown, in order. */
export function splitTrace(text: string): ProseChunk[] {
  const out: ProseChunk[] = [];
  let md: string[] = [];
  let trace: TraceLine[] = [];
  const flushMd = () => {
    const s = md.join("\n");
    if (s.trim()) out.push({ kind: "markdown", text: s });
    md = [];
  };
  const flushTrace = () => {
    if (trace.length) out.push({ kind: "trace", lines: trace });
    trace = [];
  };
  for (const line of text.split("\n")) {
    const t = parseTraceLine(line);
    if (t) {
      flushMd();
      trace.push(t);
    } else {
      // Blank lines between activity lines belong to the activity run.
      if (trace.length && !line.trim()) continue;
      flushTrace();
      md.push(line);
    }
  }
  flushMd();
  flushTrace();
  return out;
}

/** "Searched 3 times · read 2 pages · ran 1 command", for a folded activity run. */
export function traceSummary(lines: TraceLine[]): string {
  const n = (verb: string) => lines.filter((l) => l.verb === verb).length;
  const plural = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`;
  const parts: string[] = [];
  if (n("searched")) parts.push(`searched ${plural(n("searched"), "time", "times")}`);
  if (n("read")) parts.push(`read ${plural(n("read"), "page", "pages")}`);
  if (n("ran")) parts.push(`ran ${plural(n("ran"), "command", "commands")}`);
  const other = lines.length - n("searched") - n("read") - n("ran");
  if (other > 0) parts.push(`${other} ${other === 1 ? "note" : "notes"}`);
  const s = parts.join(" · ");
  return s ? s[0].toUpperCase() + s.slice(1) : "Activity";
}
