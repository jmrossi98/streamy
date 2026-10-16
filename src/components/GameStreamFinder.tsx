"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@/components/ui";
import {
  applyResult,
  canAdd,
  normalizeProbe,
  partitionByVerify,
  streamsToVerify,
  verifyLabel,
  type VerifyState,
} from "@/lib/streamVerifyRules";

type Candidate = { id: number; name: string; provider: string | null; logoUrl: string | null };

/**
 * "More streams for this game": provider streams that might carry it but are
 * not in the lineup yet, each one a click from being a channel. Ranked by
 * /api/live/game-streams (gameStreamRules.ts) -- a stream naming both teams
 * first. Loaded after the page, so a slow catalogue search never delays the
 * player above it.
 *
 * Names lie (2026-10-16: two "Sharks vs. Predators" streams were error pages
 * and got added anyway), so the top few are then checked one at a time by
 * mediabox's stream probe (streamVerifyRules.ts). The list shows immediately
 * and the checks fill in; one with no video is hidden and cannot be added.
 */
export function GameStreamFinder({ fixtureId }: { fixtureId: string }) {
  const router = useRouter();
  const [streams, setStreams] = useState<Candidate[] | null>(null);
  const [verify, setVerify] = useState(false);
  const [checks, setChecks] = useState<Record<number, VerifyState>>({});
  const [showHidden, setShowHidden] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const [added, setAdded] = useState<Record<number, string>>({});

  useEffect(() => {
    let live = true;
    fetch(`/api/live/game-streams?fixtureId=${encodeURIComponent(fixtureId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { streams: [] }))
      .then((d: { streams?: Candidate[]; verify?: boolean }) => {
        if (!live) return;
        setStreams(d.streams ?? []);
        setVerify(d.verify === true);
      })
      .catch(() => live && setStreams([]));
    return () => {
      live = false;
    };
  }, [fixtureId]);

  // One at a time, in rank order: the probe itself only runs one at a time,
  // and every provider line takes a single connection.
  useEffect(() => {
    if (!verify || !streams || streams.length === 0) return;
    const ids = streamsToVerify(streams);
    const ctrl = new AbortController();
    // Queued shows nothing, so this is only published with the first check.
    let states: Record<number, VerifyState> = Object.fromEntries(ids.map((id) => [id, { status: "queued" } as VerifyState]));
    (async () => {
      for (const id of ids) {
        if (ctrl.signal.aborted) return;
        if (states[id]?.status !== "queued") continue; // already settled, e.g. its provider is busy
        states = { ...states, [id]: { status: "checking" } };
        setChecks(states);
        let result;
        try {
          const res = await fetch(`/api/live/game-streams/verify?streamId=${id}`, { cache: "no-store", signal: ctrl.signal });
          result = normalizeProbe(res.ok ? await res.json() : { status: "error", reason: `HTTP ${res.status}` });
        } catch {
          if (ctrl.signal.aborted) return;
          result = normalizeProbe({ status: "error", reason: "the check did not finish" });
        }
        states = applyResult(states, streams, id, result);
        setChecks(states);
      }
    })();
    return () => ctrl.abort();
  }, [verify, streams]);

  async function add(s: Candidate) {
    if (adding !== null || !canAdd(checks[s.id])) return;
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
  const { shown, hidden } = partitionByVerify(streams, checks);

  const row = (s: Candidate) => {
    const label = verifyLabel(checks[s.id]);
    const addable = canAdd(checks[s.id]);
    return (
      <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className={addable ? "truncate text-sm text-white" : "truncate text-sm text-white/40 line-through"}>{s.name}</p>
          {added[s.id] && <p className="text-xs text-white/50">{added[s.id]}</p>}
        </div>
        {label && (
          <Badge tone={label.tone} title={label.title}>
            {label.text}
          </Badge>
        )}
        {s.provider && <Badge>{s.provider}</Badge>}
        <Button
          size="xs"
          onClick={() => add(s)}
          disabled={adding !== null || !!added[s.id] || !addable}
          title={addable ? undefined : "This stream sent no video when it was checked"}
        >
          {adding === s.id ? "Adding…" : added[s.id] ? "Added" : "Add as channel"}
        </Button>
      </li>
    );
  };

  return (
    <section className="mt-8">
      <h3 className="mb-1 text-sm font-semibold text-white/80">More streams for this game</h3>
      <p className="mb-3 text-xs text-white/40">
        From the providers&apos; catalogues, not in Live TV yet. A stream naming both teams is usually the game itself.
        {verify && " The top few are checked for video before you add them."}
        Channels added here are removed automatically about 30 minutes after the game ends.
      </p>
      {shown.length > 0 && <ul className="divide-y divide-white/5 rounded-lg border border-white/10">{shown.map(row)}</ul>}
      {hidden.length > 0 && (
        <div className="mt-2">
          <Button size="xs" variant="ghost" onClick={() => setShowHidden((v) => !v)} aria-expanded={showHidden}>
            {showHidden ? "Hide" : "Show"} {hidden.length} stream{hidden.length === 1 ? "" : "s"} with no video
          </Button>
          {showHidden && <ul className="mt-2 divide-y divide-white/5 rounded-lg border border-white/10">{hidden.map(row)}</ul>}
        </div>
      )}
    </section>
  );
}
