"use client";

import { MAX_IMAGE_EDGE, fitWithin, kindOfMime, type AttachmentRef } from "@/lib/chatAttachmentRules";

/** One file on its way to a message: uploading, attached, or refused. */
export type PendingAttachment = {
  key: string;
  name: string;
  /** An object URL for a thumbnail, revoked when the chip goes. */
  preview: string | null;
  status: "uploading" | "done" | "error";
  ref?: AttachmentRef;
  error?: string;
};

const RESIZABLE = new Set(["image/png", "image/jpeg", "image/webp"]);

export function attachmentUrl(id: string): string {
  return `/api/admin/chat-attachments/${encodeURIComponent(id)}`;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * A photo scaled to at most MAX_IMAGE_EDGE px on its long edge and re-encoded
 * (WebP where the browser can, else JPEG), so a 12 MP phone picture is a few
 * hundred KB. GIFs are sent as they are -- a canvas would flatten the
 * animation -- and a file that cannot be decoded is sent as it is too, for the
 * server to judge. The smaller of original and re-encoded is kept.
 */
export async function prepareImage(file: File): Promise<File> {
  if (!RESIZABLE.has(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_IMAGE_EDGE);
    const scaled = width !== bitmap.width || height !== bitmap.height;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    let blob = await toBlob(canvas, "image/webp", 0.85);
    if (!blob || blob.type !== "image/webp") {
      // No WebP encoder (Safari): JPEG has no alpha, so paint white under it.
      const flat = document.createElement("canvas");
      flat.width = width;
      flat.height = height;
      const fctx = flat.getContext("2d");
      if (!fctx) return file;
      fctx.fillStyle = "#fff";
      fctx.fillRect(0, 0, width, height);
      fctx.drawImage(canvas, 0, 0);
      blob = await toBlob(flat, "image/jpeg", 0.85);
    }
    if (!blob) return file;
    if (!scaled && blob.size >= file.size) return file;
    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    const base = file.name.replace(/\.[^.]*$/, "") || "image";
    return new File([blob], `${base}.${ext}`, { type: blob.type });
  } catch {
    return file;
  }
}

/** Uploads one file; throws a message fit to show. */
export async function uploadAttachment(file: File): Promise<AttachmentRef> {
  const body = new FormData();
  body.append("file", file, file.name);
  const res = await fetch("/api/admin/chat-attachments", { method: "POST", body });
  const data = (await res.json().catch(() => ({}))) as { attachment?: AttachmentRef; error?: string };
  if (!res.ok || !data.attachment) throw new Error(data.error ?? `Upload failed (HTTP ${res.status}).`);
  return data.attachment;
}

/** The chips above the composer's text box: a thumbnail or file name, a state, and a remove button. */
export function PendingChips({ items, onRemove }: { items: PendingAttachment[]; onRemove: (key: string) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2 pb-2 pr-2" aria-label="Attachments">
      {items.map((a) => (
        <li
          key={a.key}
          className={`flex max-w-[12rem] items-center gap-2 rounded-lg border px-1.5 py-1 text-xs ${
            a.status === "error" ? "border-red-400/40 bg-red-500/10 text-red-200" : "border-white/15 bg-white/10 text-white/80"
          }`}
          title={a.error ?? a.name}
        >
          {a.preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.preview} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
          ) : (
            <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white/10 text-[10px] uppercase">
              {a.ref?.mime === "application/pdf" ? "pdf" : "txt"}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">
            {a.status === "uploading" ? "Uploading…" : a.status === "error" ? (a.error ?? "Failed") : a.name}
          </span>
          <button
            type="button"
            onClick={() => onRemove(a.key)}
            className="shrink-0 rounded-full px-1 text-white/60 hover:bg-white/15 hover:text-white"
            aria-label={`Remove ${a.name}`}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The files on a sent message: image thumbnails (tap to open) and file links. */
export function SentAttachments({ items, align }: { items: AttachmentRef[]; align: "end" | "start" }) {
  if (items.length === 0) return null;
  return (
    <div className={`mb-1.5 flex flex-wrap gap-2 ${align === "end" ? "justify-end" : ""}`}>
      {items.map((a) =>
        kindOfMime(a.mime) === "image" ? (
          <a key={a.id} href={attachmentUrl(a.id)} target="_blank" rel="noreferrer" title={a.name}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={attachmentUrl(a.id)} alt={a.name} loading="lazy" className="max-h-40 max-w-[12rem] rounded-lg border border-white/15 object-cover" />
          </a>
        ) : (
          <a
            key={a.id}
            href={attachmentUrl(a.id)}
            download={a.name}
            className="flex max-w-[14rem] items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/15"
          >
            <span aria-hidden>📎</span>
            <span className="truncate">{a.name}</span>
          </a>
        )
      )}
    </div>
  );
}
