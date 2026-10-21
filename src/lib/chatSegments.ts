/**
 * Splits an assistant message into prose and code blocks.
 *
 * Pure, so it tests without a browser -- and deliberately not a markdown
 * library. The only markdown the model reliably emits here is fenced code, and
 * a full renderer would pull in a parser plus a sanitiser to guard against the
 * model echoing HTML back from a web-search result. Handling one construct in
 * thirty lines avoids both.
 */

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string; lang: string; open: boolean };

/**
 * The fence, at the start of a line, with an optional language tag.
 *
 * Anchored to a line start so a stray ``` mid-sentence (the model quoting
 * backticks while explaining something) can't open a block.
 */
const FENCE = /^[ \t]*```([^\n`]*)\n?/;

/**
 * `open` marks a block whose closing fence has not arrived yet.
 *
 * This matters because answers stream in token by token: for most of a code
 * block's life the closing fence does not exist, and treating that as prose
 * would make the text reflow into a block the instant it completed. An open
 * block renders as a block immediately, and simply isn't offered for copying
 * until it is closed -- copying half a command is worse than waiting.
 */
export function splitMessage(content: string): Segment[] {
  const segments: Segment[] = [];
  let rest = content;
  let prose = "";

  const flushProse = () => {
    if (prose) segments.push({ kind: "text", text: prose });
    prose = "";
  };

  while (rest.length > 0) {
    const nl = rest.indexOf("\n");
    const line = nl === -1 ? rest : rest.slice(0, nl + 1);
    const fence = FENCE.exec(line);

    if (!fence) {
      prose += line;
      rest = nl === -1 ? "" : rest.slice(nl + 1);
      continue;
    }

    flushProse();
    const lang = fence[1].trim();
    rest = rest.slice(fence[0].length);

    // The closing fence, likewise at a line start.
    const close = /(^|\n)[ \t]*```[ \t]*(\n|$)/.exec(rest);
    if (!close) {
      segments.push({ kind: "code", text: rest, lang, open: true });
      rest = "";
      break;
    }

    const end = close.index + (close[1] === "\n" ? 1 : 0);
    segments.push({ kind: "code", text: rest.slice(0, end), lang, open: false });
    rest = rest.slice(close.index + close[0].length);
  }

  flushProse();
  return segments;
}

/**
 * What the copy button puts on the clipboard.
 *
 * Trailing newline stripped so pasting into a terminal doesn't execute
 * immediately -- the paste should land on the prompt and wait for the person
 * to read it and press Enter themselves. That is the whole safety margin
 * between a suggested command and a run one.
 *
 * Leading `$ ` and `# ` prompts are stripped too: models emit them constantly
 * and pasting them runs the wrong thing, or nothing.
 */
export function copyableText(code: string): string {
  return code
    .split("\n")
    .map((l) => l.replace(/^[ \t]*[$#][ \t]+/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

export type InlineSpan = { kind: "text" | "bold" | "code"; text: string };

/**
 * Inline styling in prose: **bold** and `code`, nothing else. The models
 * write both constantly and the panel showed the asterisks raw. Rendered as
 * React elements by ChatMessage, never as HTML, so a reply can't inject
 * markup. An unclosed marker stays literal text.
 */
export function inlineSpans(text: string): InlineSpan[] {
  const out: InlineSpan[] = [];
  const re = /\*\*([^*\n](?:[^*\n]|\*(?!\*))*?)\*\*|`([^`\n]+)`/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push(m[1] !== undefined ? { kind: "bold", text: m[1] } : { kind: "code", text: m[2] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
