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
 *
 * Downloading is a button rather than something that happens on arrival. An
 * earlier version started the fetch as soon as the page mounted, on the
 * reasoning that landing here is already the decision -- but it took the
 * choice away at exactly the moment it mattered most: deleting a bad download
 * refreshes the page, which re-mounted this panel, which immediately fetched
 * the same bad copy again. A download is also several megabytes over someone
 * else's bandwidth, which is worth an explicit press.
 */
export function FlashImportPanel({ slug, title }: { slug: string; title: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);

  async function fetchGame() {
    if (state === "working") return;
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
      setState("failed");
    } catch {
      setError("Couldn’t reach the server.");
      setState("failed");
    }
  }

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-transparent px-6 py-16 text-center">
      {state === "working" ? (
        <>
          <span
            aria-hidden
            className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-netflix-red"
          />
          <p className="text-sm font-medium text-white/80">Getting {title} ready…</p>
          <p className="mt-1 max-w-md text-xs text-white/40">
            Fetching it and keeping it here, so this only happens once.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-white/80">
            {state === "failed"
              ? `${title} couldn’t be downloaded.`
              : `${title} isn’t downloaded yet.`}
          </p>
          {state === "failed" ? (
            error && <p className="mt-2 max-w-md text-sm text-red-400">{error}</p>
          ) : (
            <p className="mt-1 max-w-md text-xs text-white/40">
              It’ll be fetched and kept here, so this only happens once.
            </p>
          )}
          <button
            type="button"
            onClick={fetchGame}
            className="mt-5 rounded bg-netflix-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            {state === "failed" ? "Try again" : "Download & play"}
          </button>
        </>
      )}
    </div>
  );
}
