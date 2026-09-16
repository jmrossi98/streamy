"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Admin-only: throws away a game's downloaded file.
 *
 * The repair for a game that downloaded badly -- a domain-locked build, a
 * regional rip in the wrong language, a loader stub picked instead of the
 * game. Opening the game afterwards fetches it again, and because stored
 * files are content-hashed, the fresh copy lands at a new URL rather than
 * behind the old one's immutable cache entry.
 *
 * Keeps the catalogue row, so My List entries and saved games survive. That
 * is also why this doesn't ask for confirmation: nothing irreplaceable goes,
 * and the file comes back on the next play.
 */
export function FlashDeleteButton({
  slug,
  onDeleted,
}: {
  slug: string;
  /** Called instead of refreshing, when the caller manages its own list. */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/flash/downloads?slug=${encodeURIComponent(slug)}`,
        { method: "DELETE" }
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
      };
      if (res.ok && data.ok) {
        if (onDeleted) onDeleted();
        else router.refresh();
        return;
      }
      setError(data.reason ?? "Couldn’t delete the download.");
    } catch {
      setError("Couldn’t reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        title="Delete the downloaded file; it re-downloads on the next play"
        className="rounded border border-white/15 px-3 py-1.5 text-sm text-white/70 transition-colors hover:border-red-500/50 hover:text-red-300 disabled:opacity-50"
      >
        {busy ? "Deleting…" : "Delete download"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
