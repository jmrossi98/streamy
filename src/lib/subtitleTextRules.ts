/**
 * Subtitle text the browser can show. Pure.
 *
 * Jellyfin converts a file's subtitles to WebVTT on request, but from ASS
 * (most anime releases) it keeps the override codes in the text: Cowboy
 * Bebop's dialogue came through as "{\i1}brings you information about
 * fugitives!{\i0}", and a <track> shows that literally (2026-11-15). Italic,
 * bold and underline become WebVTT's own <i>, <b> and <u>; every other code
 * (position, fade, colour, font) is dropped, and so is vector drawing text,
 * which would otherwise show as "m 0 0 l 100 0".
 */

/** An ASS override block: "{\i1}", "{\an8\fad(200,200)}". Braces without a backslash are left alone. */
const OVERRIDE = /\{[^{}]*\\[^{}]*\}/g;
/** From a drawing-mode block ({\p1}) to the block that ends it ({\p0}) or the end of the line. */
const DRAWING = /\{[^{}]*\\p[1-9][^{}]*\}.*?(?:\{[^{}]*\\p0[^{}]*\}|$)/g;
const TOGGLES: [RegExp, string][] = [
  [/\\i1(?![0-9])/, "<i>"],
  [/\\i0(?![0-9])/, "</i>"],
  [/\\b(?:1|[1-9]00)(?![0-9])/, "<b>"],
  [/\\b0(?![0-9])/, "</b>"],
  [/\\u1(?![0-9])/, "<u>"],
  [/\\u0(?![0-9])/, "</u>"],
];

/** One override block as WebVTT tags, in the order ASS lists them. */
function asTags(block: string): string {
  const found: [number, string][] = [];
  for (const [re, tag] of TOGGLES) {
    const m = re.exec(block);
    if (m) found.push([m.index, tag]);
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, tag]) => tag).join("");
}

/** One cue-text line: codes translated or dropped, ASS line breaks made real. Returns the lines it becomes. */
function cleanLine(line: string): string[] {
  if (!line.includes("\\") && !line.includes("{")) return [line];
  const text = line
    .replace(DRAWING, "")
    .replace(OVERRIDE, asTags)
    .replace(/\\h/g, " ")
    .replace(/\\[Nn]/g, "\n");
  // An empty line ends a WebVTT cue, so a line left with no words is dropped
  // rather than cutting the cue short.
  return text.split("\n").filter((l) => l.replace(/<\/?[ibu]>/g, "").trim() !== "");
}

/**
 * The WebVTT document with ASS codes cleaned out of its cue text. A document
 * without any comes back unchanged. Headers, timings and the blank lines
 * between cues are kept as they are.
 */
export function cleanSubtitleText(vtt: string): string {
  if (!/\\|\{/.test(vtt)) return vtt;
  const out: string[] = [];
  for (const line of vtt.split(/\r?\n/)) {
    if (line.trim() === "" || line.includes("-->")) {
      out.push(line);
      continue;
    }
    out.push(...cleanLine(line));
  }
  return out.join("\n");
}
