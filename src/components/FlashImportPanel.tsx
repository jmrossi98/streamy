"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Shown for a game that is known but not downloaded.
 *
 * Adding a game to a list records it; it does not fetch it. That separation is
 * what lets someone bookmark from a 180,000-entry archive without pulling
 * gigabytes nobody asked for. This is the other half: the point at which
 * someone actually wants to play, so the file is worth fetching.
 */
export function FlashImportPanel({ slug, title }: { slug: string; title: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "working">("idle");
  const [error, setError] = useState<string | null>(null);

  async function fetchGame() {
    setState("working");
    setError(null);
    try {
      const res = await fetch(`/api/flash/import/${encodeURIComponent(slug)}`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
      if (res.ok && data.ok) {
        // Re-renders the server component, which now finds a file and shows
        // the player in place of this panel.
        router.refresh();
        return;
      }
      setError(data.reason ?? "Couldn’t download this game.");
    } catch {
      setError("Couldn’t reach the server.");
    } finally {
      setState("idle");
    }
  }

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-white/10 bg-netflix-dark/60 px-6 py-12 text-center">
      <p className="text-sm text-white/70">{title} isn’t downloaded yet.</p>
      <p className="mt-1 max-w-md text-xs text-white/40">
        It’ll be fetched from Flashpoint Archive and kept here, so this only happens once.
      </p>
      <button
        type="button"
        onClick={fetchGame}
        disabled={state === "working"}
        className="mt-4 rounded bg-netflix-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
      >
        {state === "working" ? "Downloading…" : "Download & play"}
      </button>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}
