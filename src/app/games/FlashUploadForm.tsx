"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Adds a SWF by uploading it.
 *
 * The alternative was copying the file to mediabox and then pressing Scan,
 * which meant leaving the browser to add a game to a web app. Since these are
 * stored on Streamy's own volume now, an upload is both simpler for the person
 * doing it and one fewer moving part.
 */
export function FlashUploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file || busy) return;

    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/flash/upload", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { title?: string; error?: string };
      if (!res.ok) {
        setMessage(data.error ?? `Upload failed (HTTP ${res.status}).`);
        return;
      }
      setMessage(`Added ${data.title ?? file.name}.`);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch {
      setMessage("Couldn’t reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={upload} className="rounded-lg border border-white/10 bg-netflix-dark/60 p-4">
      <h3 className="mb-1 text-sm font-semibold text-white">Upload a .swf</h3>
      <p className="mb-3 text-xs text-white/40">
        For a game Flashpoint doesn’t have. Stored on Streamy and playable immediately.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".swf,application/x-shockwave-flash"
          className="min-w-0 flex-1 text-sm text-white/70 file:mr-3 file:rounded file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-white/20"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-netflix-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-40"
        >
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
      {message && <p className="mt-2 text-sm text-white/50">{message}</p>}
    </form>
  );
}
