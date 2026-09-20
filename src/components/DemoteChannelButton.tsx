"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Admin-only "remove this channel from Live TV", from the channel's own page.
 *
 * Same action and same endpoint as Browse all streams' "Remove channel"
 * button -- this is just a second entry point to it, for an admin who has
 * already navigated to the channel rather than gone looking for it in the
 * stream catalogue. The underlying stream is untouched either way.
 */
export function DemoteChannelButton({
  channelId,
  channelName,
}: {
  /** Dispatcharr's numeric channel id -- not the Jellyfin id this page is keyed by. */
  channelId: number;
  channelName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function demote() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/live/streams/demote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? "Couldn't remove that channel.");
        setBusy(false);
        return;
      }
      // This page is about the channel that just stopped existing in the
      // lineup -- Live TV, not a reload of a page that would 404, is where
      // an admin actually wants to land next.
      router.push("/live");
    } catch {
      setError("Couldn't remove that channel.");
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-red-400">{error}</span>}
      <button
        type="button"
        onClick={demote}
        disabled={busy}
        title={`Remove "${channelName}" from Live TV -- the stream stays in the catalogue`}
        className="rounded border border-white/20 px-3 py-1.5 text-sm text-white/60 transition-colors hover:border-red-400/50 hover:text-red-400 disabled:opacity-50"
      >
        {busy ? "Removing…" : "Remove channel"}
      </button>
    </span>
  );
}
