/**
 * A tailored resume as a PDF, for attaching to an application.
 *
 * Real text in a standard font, single column, no images -- what an applicant
 * tracking system parses best, and the same layout rules the resume prompt
 * already follows. Handles the Markdown subset that prompt produces: "# Name",
 * a contact line, "## Section", "### Role", "- bullets", paragraphs, **bold**.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 50;
const MARGIN_Y = 46;
const WIDTH = PAGE_W - MARGIN_X * 2;

/** The standard fonts are WinAnsi-only; anything else would throw on draw. */
const REPLACE: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "≤": "<=",
  "≥": ">=",
  "×": "x",
  "≈": "~",
  "‑": "-",
  "‒": "-",
  "−": "-",
  " ": " ",
};
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

export function toWinAnsi(s: string): string {
  let out = "";
  for (const ch of s) {
    if (REPLACE[ch] !== undefined) out += REPLACE[ch];
    else if (ch.charCodeAt(0) < 0x7f && ch.charCodeAt(0) >= 0x20) out += ch;
    else if ((ch.charCodeAt(0) >= 0xa0 && ch.charCodeAt(0) <= 0xff) || WIN_ANSI_EXTRA.has(ch)) out += ch;
    else if (ch === "\t") out += " ";
  }
  return out;
}

/** "**bold** plain" -> styled words. Links [t](u) keep their text. */
function words(text: string): { word: string; bold: boolean }[] {
  const clean = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/(^|\s)_([^_]+)_(?=\s|$)/g, "$1$2");
  const out: { word: string; bold: boolean }[] = [];
  clean.split("**").forEach((part, i) => {
    for (const w of part.split(/\s+/).filter(Boolean)) out.push({ word: toWinAnsi(w.replace(/\*/g, "")), bold: i % 2 === 1 });
  });
  return out.filter((w) => w.word);
}

class Writer {
  page: PDFPage;
  y: number;
  constructor(
    private doc: PDFDocument,
    private regular: PDFFont,
    private bold: PDFFont
  ) {
    this.page = doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN_Y;
  }

  private ensure(height: number) {
    if (this.y - height < MARGIN_Y) {
      this.page = this.doc.addPage([PAGE_W, PAGE_H]);
      this.y = PAGE_H - MARGIN_Y;
    }
  }

  /** Word-wrapped styled text starting at x, hanging-indented to `indent`. */
  paragraph(text: string, opts: { size: number; x?: number; indent?: number; bold?: boolean; center?: boolean; gap?: number }) {
    const size = opts.size;
    const lineH = size * 1.28;
    const x0 = MARGIN_X + (opts.x ?? 0);
    const indent = MARGIN_X + (opts.indent ?? opts.x ?? 0);
    const items = words(text).map((w) => ({ ...w, bold: w.bold || Boolean(opts.bold) }));
    const space = this.regular.widthOfTextAtSize(" ", size);
    let line: typeof items = [];
    let lineW = 0;
    let first = true;
    const flush = () => {
      if (!line.length) return;
      this.ensure(lineH);
      const start = first ? x0 : indent;
      let x = opts.center ? (PAGE_W - lineW) / 2 : start;
      for (const w of line) {
        const font = w.bold ? this.bold : this.regular;
        this.page.drawText(w.word, { x, y: this.y - size, size, font, color: rgb(0.1, 0.1, 0.1) });
        x += font.widthOfTextAtSize(w.word, size) + space;
      }
      this.y -= lineH;
      line = [];
      lineW = 0;
      first = false;
    };
    for (const w of items) {
      const width = (w.bold ? this.bold : this.regular).widthOfTextAtSize(w.word, size);
      const avail = PAGE_W - MARGIN_X - (first ? x0 : indent);
      if (line.length && lineW + space + width > avail) flush();
      lineW += (line.length ? space : 0) + width;
      line.push(w);
    }
    flush();
    this.y -= opts.gap ?? 0;
  }

  bullet(text: string, size: number) {
    this.ensure(size * 1.28);
    this.page.drawText("•", { x: MARGIN_X + 6, y: this.y - size, size, font: this.regular });
    this.paragraph(text, { size, x: 18, indent: 18, gap: 1.5 });
  }

  rule() {
    this.page.drawLine({
      start: { x: MARGIN_X, y: this.y + 2 },
      end: { x: MARGIN_X + WIDTH, y: this.y + 2 },
      thickness: 0.6,
      color: rgb(0.55, 0.55, 0.55),
    });
    this.y -= 4;
  }

  space(h: number) {
    this.y -= h;
  }
}

export async function resumeToPdf(markdown: string, title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(toWinAnsi(title));
  doc.setCreator("Streamy");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, regular, bold);

  let sawName = false;
  let afterName = false;
  for (const rawLine of markdown.replace(/\r/g, "").split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      w.space(3);
      continue;
    }
    if (/^---+$/.test(line.trim())) continue;
    let m: RegExpExecArray | null;
    if ((m = /^#\s+(.*)/.exec(line)) && !sawName) {
      w.paragraph(m[1], { size: 20, bold: true, center: true, gap: 2 });
      sawName = afterName = true;
      continue;
    }
    if ((m = /^##\s+(.*)/.exec(line))) {
      afterName = false;
      w.space(6);
      w.paragraph(m[1].toUpperCase(), { size: 11, bold: true, gap: 1 });
      w.rule();
      continue;
    }
    if ((m = /^#{3,}\s+(.*)/.exec(line))) {
      w.space(2);
      w.paragraph(m[1], { size: 10.5, bold: true, gap: 1 });
      continue;
    }
    if ((m = /^\s*[-*+]\s+(.*)/.exec(line))) {
      w.bullet(m[1], 10);
      continue;
    }
    if (afterName) {
      // The contact line(s) under the name.
      w.paragraph(line, { size: 9.5, center: true, gap: 1 });
      continue;
    }
    w.paragraph(line, { size: 10, gap: 1.5 });
  }
  return doc.save();
}
