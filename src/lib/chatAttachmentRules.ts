/**
 * Files attached to an admin-chat message: what may be uploaded, how the type
 * is decided, and how an attachment becomes model input.
 *
 * Pure, so it tests without the database or a provider. The upload is data
 * from a browser like any other: the type is read from the file's own bytes
 * (never the name or the declared Content-Type), and anything that is not a
 * raster image, a PDF or plain text is refused -- SVG and HTML above all,
 * since both can carry script.
 */

import type { ChatMessage } from "./ollama";

/** Bytes per file, after the browser has downscaled an image. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
/** Files per message. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 4;
/** Long edge, in px, an image is downscaled to before upload. */
export const MAX_IMAGE_EDGE = 2000;
/** Name length kept. */
const MAX_NAME_CHARS = 120;

/**
 * Characters of attached text (files and PDFs together) that go to the model
 * in one request. The local model's context is 8k tokens and already carries
 * the status block; the cloud models take what the career context takes
 * (40k, see the chat route).
 */
export const ATTACHMENT_TEXT_BUDGET = { local: 5_000, remote: 40_000 } as const;

export type AttachmentKind = "image" | "text" | "pdf";

/** What a turn stores about an attachment; the bytes live in ChatAttachment. */
export type AttachmentRef = { id: string; name: string; mime: string; size: number };

export type ImageInput = { mime: string; data: string };

const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/** Extensions accepted as plain text (log, code, JSON, Markdown...). No svg, html or xml. */
export const TEXT_EXTENSIONS = new Set([
  "txt", "log", "md", "markdown", "json", "jsonl", "csv", "tsv", "yaml", "yml", "toml", "ini", "conf", "cfg", "env",
  "sh", "bash", "zsh", "py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "sql", "go", "rs", "java", "kt", "c", "h",
  "cpp", "hpp", "cs", "rb", "php", "pl", "lua", "swift", "diff", "patch", "service", "dockerfile", "gitignore",
]);

/** The file input's accept list: what the picker offers. The server checks again. */
export const ATTACHMENT_ACCEPT = [
  ...IMAGE_MIMES,
  "application/pdf",
  ...[...TEXT_EXTENSIONS].map((e) => `.${e}`),
].join(",");

export type Sniffed = { ok: true; mime: string; kind: AttachmentKind } | { ok: false; error: string };

function startsWith(b: Uint8Array, sig: number[], at = 0): boolean {
  return b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
}

export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  // "Dockerfile" and ".gitignore" are their own extension.
  return (dot <= 0 ? base.replace(/^\./, "") : base.slice(dot + 1)).toLowerCase();
}

/** A file name safe to store and to put in a header: no path, no control characters. */
export function cleanFileName(raw: unknown): string {
  const base = typeof raw === "string" ? (raw.split(/[\\/]/).pop() ?? "") : "";
  const flat = base.replace(/[\u0000-\u001f\u007f"<>|?*]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_CHARS);
  return flat || "attachment";
}

/** Markup that must never be stored as "text": an SVG or HTML page renamed .txt. */
const MARKUP_START = /^\s*<(!doctype\s+html|html|svg|\?xml|script|head|body|iframe|!--)/i;

/**
 * Decides what a file is from its bytes. The name only narrows text: a text
 * file must carry a known text extension, so an unknown binary is refused
 * rather than guessed at.
 */
export function sniffAttachment(bytes: Uint8Array, name: string): Sniffed {
  if (bytes.length === 0) return { ok: false, error: "That file is empty." };
  if (bytes.length > MAX_ATTACHMENT_BYTES) return { ok: false, error: "That file is over 5 MB." };

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ok: true, mime: "image/png", kind: "image" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { ok: true, mime: "image/jpeg", kind: "image" };
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) {
    return { ok: true, mime: "image/gif", kind: "image" };
  }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { ok: true, mime: "image/webp", kind: "image" };
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { ok: true, mime: "application/pdf", kind: "pdf" };

  if (!TEXT_EXTENSIONS.has(extensionOf(name))) {
    return { ok: false, error: "Only images (PNG, JPEG, WebP, GIF), PDFs and text files can be attached." };
  }
  // NUL bytes mean binary; invalid UTF-8 means not text we can inline.
  if (bytes.includes(0)) return { ok: false, error: "That file isn't plain text." };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: "That file isn't UTF-8 text." };
  }
  if (MARKUP_START.test(text.replace(/^﻿/, "").slice(0, 512))) {
    return { ok: false, error: "HTML and SVG files can't be attached." };
  }
  return { ok: true, mime: "text/plain", kind: "text" };
}

export function kindOfMime(mime: string): AttachmentKind | null {
  if ((IMAGE_MIMES as readonly string[]).includes(mime)) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/plain") return "text";
  return null;
}

/** Ids come from cuid(); anything else in a request is not one of ours. */
const ID_RE = /^[a-z0-9]{8,40}$/i;
export function isAttachmentId(v: unknown): v is string {
  return typeof v === "string" && ID_RE.test(v);
}

/**
 * The attachment refs a turn may carry, from a submitted or stored value:
 * well-formed, no repeats, at most MAX_ATTACHMENTS_PER_MESSAGE.
 */
export function normalizeAttachmentRefs(raw: unknown): AttachmentRef[] {
  if (!Array.isArray(raw)) return [];
  const out: AttachmentRef[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const { id, name, mime, size } = r as Record<string, unknown>;
    if (!isAttachmentId(id) || out.some((o) => o.id === id)) continue;
    if (typeof mime !== "string" || !kindOfMime(mime)) continue;
    if (typeof size !== "number" || !Number.isFinite(size) || size < 0 || size > MAX_ATTACHMENT_BYTES) continue;
    out.push({ id, name: cleanFileName(name), mime, size: Math.floor(size) });
    if (out.length === MAX_ATTACHMENTS_PER_MESSAGE) break;
  }
  return out;
}

/** The ids a transcript refers to, for linking uploads to the chat that saved them. */
export function attachmentIdsIn(turns: readonly { attachments?: readonly AttachmentRef[] }[]): string[] {
  const ids = new Set<string>();
  for (const t of turns) for (const a of t.attachments ?? []) ids.add(a.id);
  return [...ids];
}

/** Scales (w, h) down so the long edge is at most `max`; never up. */
export function fitWithin(w: number, h: number, max: number = MAX_IMAGE_EDGE): { width: number; height: number } {
  const long = Math.max(w, h);
  if (long <= max) return { width: w, height: h };
  const k = max / long;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** Why a picked set of files can't be added to a message, or null when it can. */
export function checkPicked(existing: number, files: readonly { size: number }[]): string | null {
  if (existing + files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return `A message can carry ${MAX_ATTACHMENTS_PER_MESSAGE} attachments at most.`;
  }
  if (files.some((f) => f.size > MAX_ATTACHMENT_BYTES)) return "Files over 5 MB can't be attached.";
  return null;
}

/**
 * Response headers for serving a stored attachment. Raster images show inline
 * (thumbnails); PDFs and text download. Always nosniff, and a CSP that
 * sandboxes the response in case anything ever did render it.
 */
export function attachmentHeaders(name: string, mime: string, length: number): Record<string, string> {
  const inline = kindOfMime(mime) === "image";
  const safe = cleanFileName(name);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "_");
  return {
    "Content-Type": mime === "text/plain" ? "text/plain; charset=utf-8" : mime,
    "Content-Length": String(length),
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    "Cache-Control": "private, max-age=3600",
  };
}

// --- Becoming model input ---------------------------------------------------

/** An attachment as the chat route loads it: bytes, plus the text of a text file or PDF. */
export type LoadedAttachment = AttachmentRef & { kind: AttachmentKind; bytes: Uint8Array; text?: string };

export const IMAGE_UNREADABLE_NOTICE = "This model can't read images - switch to Claude";

/** A truncated text ends in this, so the model knows it saw only the start. */
export function truncationMarker(omitted: number): string {
  return `[... truncated: ${omitted} more characters not shown]`;
}

/** The start of `text` that fits `max` characters, plus a marker when something was cut. */
export function truncateWithMarker(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max))}\n${truncationMarker(text.length - Math.max(0, max))}`;
}

/** Text in a fenced block, with a fence longer than any backtick run inside it. */
export function fenceText(name: string, text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  const ext = extensionOf(name);
  const lang = /^[a-z0-9]{1,10}$/.test(ext) && ext !== "txt" ? ext : "";
  return `Attached file "${name}":\n${fence}${lang}\n${text}\n${fence}`;
}

export type AttachmentContext = {
  /** Loaded by the route, scoped to the admin; ids a client names that aren't here are ignored. */
  loaded: ReadonlyMap<string, LoadedAttachment>;
  /** Whether the route that will answer reads images. */
  vision: boolean;
  /** Characters of attached text for the whole request. */
  textBudget: number;
};

/**
 * One message's text and images with its attachments applied.
 *
 * `budget.left` is shared across the request and drawn on newest message
 * first (the caller walks backwards), so a long log in an old message can't
 * crowd out the file just attached. Images go only on the newest message that
 * has any: a re-sent photo is re-billed every turn.
 */
export function applyAttachments(
  text: string,
  refs: readonly AttachmentRef[],
  ctx: AttachmentContext,
  state: { budget: number; imagesTaken: boolean }
): { content: string; images: ImageInput[]; imagesDropped: number } {
  const parts: string[] = text ? [text] : [];
  const images: ImageInput[] = [];
  let imagesDropped = 0;
  const isNewest = !state.imagesTaken;
  let tookImages = false;
  for (const ref of refs) {
    const a = ctx.loaded.get(ref.id);
    if (!a) {
      parts.push(`[Attachment "${ref.name}" is no longer available.]`);
      continue;
    }
    if (a.kind === "image") {
      if (!ctx.vision) {
        imagesDropped++;
        parts.push(`[Image "${a.name}" was attached but not sent: this model can't read images.]`);
      } else if (!isNewest) {
        parts.push(`[Image "${a.name}" was attached to an earlier message and is not re-sent.]`);
      } else {
        images.push({ mime: a.mime, data: Buffer.from(a.bytes).toString("base64") });
        tookImages = true;
      }
      continue;
    }
    const body = a.text ?? "";
    if (state.budget <= 0) {
      parts.push(`[Attached file "${a.name}" omitted: the attached-text limit for this request was used up.]`);
      continue;
    }
    const shown = truncateWithMarker(body, state.budget);
    state.budget -= Math.min(body.length, state.budget);
    parts.push(fenceText(a.name, shown));
  }
  if (tookImages) state.imagesTaken = true;
  return { content: parts.join("\n\n"), images, imagesDropped };
}

/** True when some message sent carries an image the answering model won't see. */
export function imagesWillBeDropped(refs: readonly AttachmentRef[], vision: boolean): boolean {
  return !vision && refs.some((r) => kindOfMime(r.mime) === "image");
}

// --- Provider shapes ----------------------------------------------------------

/**
 * OpenAI-style messages (OpenRouter): a message with images becomes a list of
 * parts, text first. Messages without images are passed through untouched.
 */
export function toOpenAiMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (!m.images?.length) return { role: m.role, content: m.content };
    return {
      role: m.role,
      content: [
        ...(m.content.trim() ? [{ type: "text", text: m.content }] : []),
        ...m.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.data}` } })),
      ],
    };
  });
}
