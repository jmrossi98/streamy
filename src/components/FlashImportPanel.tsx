"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Shown for a game that is known but not downloaded.
 *
 * Adding a game to a list records it; it does not fetch it. That separation is
 * what lets someone bookmark from a 180,000-entry archive without pulling
 * gigabytes nobody asked for. This is the other half: the point at which
 * someone actually wants to play, so the file is worth fetching.
 *
 * The fetch starts on arrival rather than waiting for a click. Landing here is
 * already the decision -- every route in is someone choosing this game -- and
 * the old "Download & play" button just put a second, identical decision in
 * front of the same person. A failure still offers a retry, because that is a
 * genuine choice.
 */
export function FlashImportPanel({ slug, title }: { slug: string; title: string }) {
  const router = useRouter();
  const [state, setState] = useState<"working" | "failed">("working");
  const [error, setError] = useState<string | null>(null);
  // Guards the auto-start against a second run (React strict mode mounts
  // effects twice in development, and a GameZIP is multiple megabytes).
  const started = useRef(false);

  const fetchGame = useCallback(async () => {
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
  }, [router, slug]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void fetchGame();
  }, [fetchGame]);

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
            Fetching it from Flashpoint Archive and keeping it here, so this only
            happens once.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-white/80">{title} couldn’t be downloaded.</p>
          {error && <p className="mt-2 max-w-md text-sm text-red-400">{error}</p>}
          <button
            type="button"
            onClick={fetchGame}
            className="mt-5 rounded bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
          >
            Try again
          </button>
        </>
      )}
    </div>
  );
}
