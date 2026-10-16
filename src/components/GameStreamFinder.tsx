"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@/components/ui";

type Candidate = { id: number; name: string; provider: string | null; logoUrl: string | null };

/**
 * "More streams for this game": provider streams that might carry it but are
 * not in the lineup yet, each one a click from being a channel. Ranked by
 * /api/live/game-streams (gameStreamRules.ts) -- a stream naming both teams
 * first. Loaded after the page, so a slow catalogue search never delays the
 * player above it.
 */
export function GameStreamFinder({ fixtureId }: { fixtureId: string }) {
  const router = useRouter();
  const [streams, setStreams] = useState<Candidate[] | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const [added, setAdded] = useState<Record<number, string>>({});

  useEffect(() => {
    let live = true;
    fetch(`/api/live/game-streams?fixtureId=${encodeURIComponent(fixtureId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { streams: [] }))
      .then((d: { streams?: Candidate[] }) => live && setStreams(d.streams ?? []))
      .catch(() => live && setStreams([]));
    return () => {
      live = false;
    };
  }, [fixtureId]);

  async function add(s: Candidate) {
    if (adding !== null) return;
    setAdding(s.id);
    try {
      const res = await fetch("/api/live/streams/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // fixtureId marks it as a one-game channel, removed after the game.
        body: JSON.stringify({ streamId: s.id, name: s.name, logoUrl: s.logoUrl, fixtureId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setAdded((a) => ({ ...a, [s.id]: res.ok ? "Added. It joins the list above in a few seconds." : body.error ?? "Couldn't add it." }));
      // Jellyfin picks the new channel up on its guide refresh, which the
      // promote route starts; give it a moment, then reload the options.
      if (res.ok) setTimeout(() => router.refresh(), 8000);
    } finally {
      setAdding(null);
    }
  }

  if (!streams || streams.length === 0) return null;
  return (
    <section className="mt-8">
      <h3 className="mb-1 text-sm font-semibold text-white/80">More streams for this game</h3>
      <p className="mb-3 text-xs text-white/40">
        From the providers&apos; catalogues, not in Live TV yet. A stream naming both teams is usually the game itself.
        Channels added here are removed automatically about 30 minutes after the game ends.
      </p>
      <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
        {streams.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-white">{s.name}</p>
              {added[s.id] && <p className="text-xs text-white/50">{added[s.id]}</p>}
            </div>
            {s.provider && <Badge>{s.provider}</Badge>}
            <Button size="xs" onClick={() => add(s)} disabled={adding !== null || !!added[s.id]}>
              {adding === s.id ? "Adding…" : added[s.id] ? "Added" : "Add as channel"}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
