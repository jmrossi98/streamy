import { describe, it, expect } from "vitest";
import {
  ATTACHMENT_TEXT_BUDGET,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  applyAttachments,
  attachmentHeaders,
  attachmentIdsIn,
  checkPicked,
  cleanFileName,
  fenceText,
  fitWithin,
  imagesWillBeDropped,
  normalizeAttachmentRefs,
  sniffAttachment,
  toOpenAiMessages,
  truncateWithMarker,
  type AttachmentContext,
  type LoadedAttachment,
} from "../chatAttachmentRules";

const bytes = (...b: number[]) => new Uint8Array(b);
const text = (s: string) => new TextEncoder().encode(s);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const GIF = text("GIF89a\x01\x00");
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50);
const PDF = text("%PDF-1.7\n%âãÏÓ");

describe("sniffAttachment", () => {
  it("identifies the allowed images, PDFs and text by their bytes", () => {
    expect(sniffAttachment(PNG, "a.png")).toEqual({ ok: true, mime: "image/png", kind: "image" });
    expect(sniffAttachment(JPEG, "a.jpg")).toEqual({ ok: true, mime: "image/jpeg", kind: "image" });
    expect(sniffAttachment(GIF, "a.gif")).toEqual({ ok: true, mime: "image/gif", kind: "image" });
    expect(sniffAttachment(WEBP, "a.webp")).toEqual({ ok: true, mime: "image/webp", kind: "image" });
    expect(sniffAttachment(PDF, "a.pdf")).toEqual({ ok: true, mime: "application/pdf", kind: "pdf" });
    expect(sniffAttachment(text("hello\n"), "notes.txt")).toEqual({ ok: true, mime: "text/plain", kind: "text" });
    expect(sniffAttachment(text('{"a":1}'), "x.json").ok).toBe(true);
    expect(sniffAttachment(text("# Title"), "README.md").ok).toBe(true);
    expect(sniffAttachment(text("print(1)"), "run.py").ok).toBe(true);
    expect(sniffAttachment(text("2026-10-25 error\n"), "app.log").ok).toBe(true);
  });

  // The type is the file's own bytes; a name and a claimed type are not evidence.
  it("ignores the name for binary types", () => {
    expect(sniffAttachment(PNG, "photo.txt")).toMatchObject({ mime: "image/png" });
    expect(sniffAttachment(PDF, "x.png")).toMatchObject({ mime: "application/pdf" });
  });

  it("rejects SVG however it is named", () => {
    const svg = text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffAttachment(svg, "logo.svg").ok).toBe(false);
    expect(sniffAttachment(svg, "logo.png").ok).toBe(false);
    expect(sniffAttachment(svg, "logo.txt").ok).toBe(false);
    expect(sniffAttachment(text('<?xml version="1.0"?><svg/>'), "logo.txt").ok).toBe(false);
  });

  it("rejects HTML however it is named", () => {
    for (const html of ["<!DOCTYPE html><html></html>", "  <html><body>x</body></html>", "<script>alert(1)</script>", "\uFEFF<html>"]) {
      expect(sniffAttachment(text(html), "page.html").ok).toBe(false);
      expect(sniffAttachment(text(html), "page.txt").ok).toBe(false);
      expect(sniffAttachment(text(html), "page.md").ok).toBe(false);
    }
  });

  it("rejects anything else", () => {
    expect(sniffAttachment(bytes(0x50, 0x4b, 3, 4, 0, 0), "a.zip").ok).toBe(false);
    expect(sniffAttachment(bytes(0x7f, 0x45, 0x4c, 0x46, 2, 1), "prog").ok).toBe(false);
    expect(sniffAttachment(text("plain words"), "words.exe").ok).toBe(false);
    expect(sniffAttachment(text("plain words"), "noextension").ok).toBe(false);
  });

  it("rejects binary and non-UTF-8 content under a text name", () => {
    expect(sniffAttachment(bytes(0x68, 0x69, 0x00, 0x01), "x.txt").ok).toBe(false);
    expect(sniffAttachment(bytes(0xff, 0xfe, 0xfd, 0x41), "x.txt").ok).toBe(false);
  });

  it("rejects an empty file and one over 5 MB", () => {
    expect(sniffAttachment(new Uint8Array(0), "a.txt").ok).toBe(false);
    const big = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    big.set(PNG);
    expect(sniffAttachment(big, "a.png").ok).toBe(false);
    const exact = new Uint8Array(MAX_ATTACHMENT_BYTES);
    exact.set(PNG);
    expect(sniffAttachment(exact, "a.png").ok).toBe(true);
  });
});

describe("limits", () => {
  it("allows four files per message", () => {
    expect(MAX_ATTACHMENTS_PER_MESSAGE).toBe(4);
    expect(checkPicked(0, [{ size: 1 }, { size: 1 }, { size: 1 }, { size: 1 }])).toBeNull();
    expect(checkPicked(3, [{ size: 1 }, { size: 1 }])).toMatch(/4 attachments/);
    expect(checkPicked(4, [{ size: 1 }])).toMatch(/4 attachments/);
  });

  it("refuses a file over 5 MB", () => {
    expect(checkPicked(0, [{ size: MAX_ATTACHMENT_BYTES }])).toBeNull();
    expect(checkPicked(0, [{ size: MAX_ATTACHMENT_BYTES + 1 }])).toMatch(/5 MB/);
  });

  it("keeps at most four well-formed refs per turn", () => {
    const ref = (n: number) => ({ id: `abcdefgh${n}`, name: `f${n}.png`, mime: "image/png", size: 10 });
    const refs = normalizeAttachmentRefs([ref(1), ref(2), ref(3), ref(4), ref(5)]);
    expect(refs.map((r) => r.id)).toEqual(["abcdefgh1", "abcdefgh2", "abcdefgh3", "abcdefgh4"]);
  });

  it("drops refs with a bad id, type or size, and repeats", () => {
    const good = { id: "abcdefgh1", name: "a.png", mime: "image/png", size: 10 };
    expect(
      normalizeAttachmentRefs([
        good,
        good,
        { ...good, id: "../etc/passwd" },
        { ...good, id: "abcdefgh2", mime: "image/svg+xml" },
        { ...good, id: "abcdefgh3", mime: "text/html" },
        { ...good, id: "abcdefgh4", size: MAX_ATTACHMENT_BYTES + 1 },
        { ...good, id: "abcdefgh5", size: -1 },
        null,
        "x",
      ])
    ).toEqual([good]);
    expect(normalizeAttachmentRefs("nope")).toEqual([]);
  });

  it("scales the long edge to 2000 and never up", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(fitWithin(2000, 2000)).toEqual({ width: 2000, height: 2000 });
  });
});

describe("names and headers", () => {
  it("strips paths and control characters from a name", () => {
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName('C:\\x\\a"b<c>.txt')).toBe("abc.txt");
    expect(cleanFileName("")).toBe("attachment");
    expect(cleanFileName(42)).toBe("attachment");
    expect(cleanFileName("a".repeat(500)).length).toBe(120);
  });

  it("serves with the sniffed type, nosniff and a disposition", () => {
    const img = attachmentHeaders("shot.png", "image/png", 12);
    expect(img["Content-Type"]).toBe("image/png");
    expect(img["X-Content-Type-Options"]).toBe("nosniff");
    expect(img["Content-Disposition"]).toMatch(/^inline; filename="shot.png"/);
    expect(img["Content-Security-Policy"]).toContain("sandbox");
    const txt = attachmentHeaders("a.log", "text/plain", 3);
    expect(txt["Content-Type"]).toBe("text/plain; charset=utf-8");
    expect(txt["Content-Disposition"]).toMatch(/^attachment;/);
    expect(attachmentHeaders("x.pdf", "application/pdf", 1)["Content-Disposition"]).toMatch(/^attachment;/);
  });

  it("cannot break out of the filename parameter", () => {
    const h = attachmentHeaders('a"; filename="evil.html\r\nX: y', "text/plain", 1)["Content-Disposition"];
    expect(h).not.toMatch(/[\r\n]/);
    expect(h.match(/filename="/g)).toHaveLength(1);
  });
});

describe("text for the model", () => {
  it("truncates with a marker that says how much was cut", () => {
    expect(truncateWithMarker("abcdef", 10)).toBe("abcdef");
    const out = truncateWithMarker("abcdefghij", 4);
    expect(out.startsWith("abcd\n")).toBe(true);
    expect(out).toContain("truncated: 6 more characters");
  });

  it("fences with more backticks than the text contains", () => {
    expect(fenceText("a.txt", "hi")).toBe('Attached file "a.txt":\n```\nhi\n```');
    expect(fenceText("a.py", "print(1)")).toContain("```py\n");
    const out = fenceText("a.md", "x\n```js\ncode\n```\n");
    expect(out).toContain("````md");
    expect(out.trimEnd().endsWith("````")).toBe(true);
  });
});

function loaded(...items: Partial<LoadedAttachment>[]): Map<string, LoadedAttachment> {
  return new Map(
    items.map((i, n) => {
      const id = i.id ?? `abcdefgh${n}`;
      const full: LoadedAttachment = {
        id,
        name: "f.txt",
        mime: "text/plain",
        size: 1,
        kind: "text",
        bytes: new Uint8Array([1, 2, 3]),
        ...i,
      };
      return [id, full];
    })
  );
}
const ctx = (m: Map<string, LoadedAttachment>, over: Partial<AttachmentContext> = {}): AttachmentContext => ({
  loaded: m,
  vision: true,
  textBudget: ATTACHMENT_TEXT_BUDGET.remote,
  ...over,
});
const refOf = (a: LoadedAttachment) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size });

describe("applyAttachments", () => {
  it("sends an image as a block on a vision route", () => {
    const m = loaded({ id: "img00001", name: "s.png", mime: "image/png", kind: "image" });
    const a = [...m.values()][0];
    const out = applyAttachments("what is this?", [refOf(a)], ctx(m), { budget: 1000, imagesTaken: false });
    expect(out.images).toEqual([{ mime: "image/png", data: Buffer.from([1, 2, 3]).toString("base64") }]);
    expect(out.content).toBe("what is this?");
    expect(out.imagesDropped).toBe(0);
  });

  it("does not send an image to a route that can't read it, and says so to the model", () => {
    const m = loaded({ id: "img00001", name: "s.png", mime: "image/png", kind: "image" });
    const a = [...m.values()][0];
    const out = applyAttachments("what is this?", [refOf(a)], ctx(m, { vision: false }), { budget: 1000, imagesTaken: false });
    expect(out.images).toEqual([]);
    expect(out.imagesDropped).toBe(1);
    expect(out.content).toContain("not sent");
    expect(imagesWillBeDropped([refOf(a)], false)).toBe(true);
    expect(imagesWillBeDropped([refOf(a)], true)).toBe(false);
  });

  it("inlines a text file as fenced text on every route, vision or not", () => {
    const m = loaded({ id: "txt00001", name: "app.log", text: "boom" });
    const a = [...m.values()][0];
    for (const vision of [true, false]) {
      const out = applyAttachments("why?", [refOf(a)], ctx(m, { vision }), { budget: 1000, imagesTaken: false });
      expect(out.content).toBe('why?\n\nAttached file "app.log":\n```log\nboom\n```');
      expect(out.images).toEqual([]);
    }
  });

  it("inlines extracted PDF text", () => {
    const m = loaded({ id: "pdf00001", name: "bill.pdf", mime: "application/pdf", kind: "pdf", text: "Total: $5" });
    const a = [...m.values()][0];
    const out = applyAttachments("", [refOf(a)], ctx(m), { budget: 1000, imagesTaken: false });
    expect(out.content).toContain("Total: $5");
    expect(out.content).toContain('"bill.pdf"');
  });

  it("truncates attached text to the budget with a marker, and spends the budget across files", () => {
    const m = loaded(
      { id: "txt00001", name: "a.txt", text: "a".repeat(80) },
      { id: "txt00002", name: "b.txt", text: "b".repeat(80) }
    );
    const refs = [...m.values()].map(refOf);
    const state = { budget: 100, imagesTaken: false };
    const out = applyAttachments("", refs, ctx(m), state);
    expect(out.content).toContain("a".repeat(80));
    expect(out.content).toContain("b".repeat(20));
    expect(out.content).not.toContain("b".repeat(21));
    expect(out.content).toContain("truncated: 60 more characters");
    expect(state.budget).toBe(0);
    const again = applyAttachments("", refs, ctx(m), state);
    expect(again.content).toContain("omitted");
  });

  it("sends images from the newest message only", () => {
    const m = loaded({ id: "img00001", name: "s.png", mime: "image/png", kind: "image" });
    const ref = refOf([...m.values()][0]);
    const state = { budget: 1000, imagesTaken: false };
    const newest = applyAttachments("now", [ref], ctx(m), state);
    const older = applyAttachments("before", [ref], ctx(m), state);
    expect(newest.images).toHaveLength(1);
    expect(older.images).toHaveLength(0);
    expect(older.content).toContain("earlier message");
  });

  it("tells the model about an attachment that is gone", () => {
    const out = applyAttachments("hi", [{ id: "gone0001", name: "x.png", mime: "image/png", size: 1 }], ctx(new Map()), {
      budget: 10,
      imagesTaken: false,
    });
    expect(out.content).toContain("no longer available");
  });
});

describe("toOpenAiMessages", () => {
  it("passes plain messages through and turns images into image_url parts", () => {
    const out = toOpenAiMessages([
      { role: "system", content: "s" },
      { role: "user", content: "look", images: [{ mime: "image/jpeg", data: "QUJD" }] },
      { role: "user", content: "", images: [{ mime: "image/png", data: "QUJD" }] },
    ]);
    expect(out[0]).toEqual({ role: "system", content: "s" });
    expect(out[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } },
      ],
    });
    expect((out[2] as { content: unknown[] }).content).toHaveLength(1);
  });
});

describe("attachmentIdsIn", () => {
  it("lists each referenced id once", () => {
    const a = { id: "abcdefgh1", name: "a", mime: "image/png", size: 1 };
    expect(attachmentIdsIn([{ attachments: [a] }, {}, { attachments: [a, { ...a, id: "abcdefgh2" }] }])).toEqual(["abcdefgh1", "abcdefgh2"]);
  });
});
