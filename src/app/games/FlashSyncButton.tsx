"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Imports any new SWFs sitting in /data/flash into the catalogue.
 *
 * Admin-only, and shown with the admin half of the tab: it pulls whole files
 * across the tailnet to read their headers, which is maintenance rather than
 * browsing. A `.swf` copied to mediabox does nothing until this runs.
 */
export function FlashSyncButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running">("idle");
  const [result, setResult] = useState<string | null>(null);

  async function sync() {
    setState("running");
    setResult(null);
    try {
      const res = await fetch("/api/admin/flash/sync", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        addedCount?: number;
        skipped?: string[];
        error?: string;
      };
      if (!res.ok) {
        setResult(data.error ?? `Sync failed (HTTP ${res.status}).`);
        return;
      }
      const added = data.addedCount ?? 0;
      const skipped = data.skipped?.length ?? 0;
      setResult(
        added === 0 && skipped === 0
          ? "Library is already up to date."
          : `Imported ${added} game${added === 1 ? "" : "s"}` +
              (skipped ? `, skipped ${skipped} unreadable file${skipped === 1 ? "" : "s"}.` : ".")
      );
      // Re-renders the server component so new rows appear without a reload.
      if (added > 0) router.refresh();
    } catch {
      setResult("Couldn’t reach the server.");
    } finally {
      setState("idle");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={sync}
        disabled={state === "running"}
        className="rounded bg-white/10 px-3 py-1.5 text-sm text-white transition-colors hover:bg-white/20 disabled:opacity-50"
      >
        {state === "running" ? "Scanning…" : "Scan Flash library"}
      </button>
      {result && <span className="text-sm text-white/50">{result}</span>}
    </div>
  );
}
