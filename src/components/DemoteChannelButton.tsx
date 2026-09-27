"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "Remove this channel from Live TV", from the channel's own page.
 *
 * Open to any signed-in viewer, like the bulk Delete on the Live TV page and
 * Browse all streams' own Remove -- three entry points to one endpoint, for
 * someone who is already looking at the channel rather than hunting for it in
 * a list. The underlying stream is untouched either way, and the server
 * records who did it.
 *
 * Confirms first, because unlike Hide this changes the lineup for everyone and
 * interrupts anyone watching.
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
    // Confirms because this is shared and one-way: it takes the channel out of
    // everyone's lineup and cuts off anyone watching it. Hiding, which is the
    // per-viewer version, needs no confirmation for exactly that reason.
    if (
      !window.confirm(
        `Remove “${channelName}” from Live TV for everyone?

` +
          "The stream stays in the catalogue and can be added back. " +
          "To remove it only for yourself, hide it from the Live TV page instead."
      )
    ) {
      return;
    }
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
