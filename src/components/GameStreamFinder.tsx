"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { announceGameFeedSearch } from "@/lib/gameFeedSearch";
import { feedLanguageRank } from "@/lib/gameStreamRules";
import { Badge, Button } from "@/components/ui";
import {
  applyResult,
  canAdd,
  normalizeProbe,
  partitionByVerify,
  pickAutoAdd,
  streamsToVerify,
  verifyLabel,
  type VerifyState,
} from "@/lib/streamVerifyRules";

type Candidate = { id: number; name: string; provider: string | null; logoUrl: string | null; score?: number | null; dated?: boolean };

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
/**
 * `autoAdd`: the game is on and no channel is confirmed for it, so the best
 * stream that names the game and passes the video check is added without a
 * click (pickAutoAdd). One per game, enforced by the promote route. Every
 * candidate is checked before the page gives up and plays a guess
 * (GameChannelPicker holds while "checking" is reported).
 */
const BUSY_RETRIES = 2;
const BUSY_RETRY_MS = 4_000;

export function GameStreamFinder({
  fixtureId,
  autoAdd = false,
  autoAddMaxScore = 1,
  autoAddDatedOnly = false,
  autoAddEnglishOnly = false,
}: {
  fixtureId: string;
  autoAdd?: boolean;
  /** The weakest gameStreamScore auto-add will take: 0 = names both teams. */
  autoAddMaxScore?: number;
  /** Only a feed whose name carries the game's date: the lineup already has an undated one. */
  autoAddDatedOnly?: boolean;
  /** Only an English-commentary feed: the lineup's dated feed is in another language. */
  autoAddEnglishOnly?: boolean;
}) {
  const router = useRouter();
  const [streams, setStreams] = useState<Candidate[] | null>(null);
  const [verify, setVerify] = useState(false);
  const [checks, setChecks] = useState<Record<number, VerifyState>>({});
  const [showHidden, setShowHidden] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const [added, setAdded] = useState<Record<number, string>>({});
  const autoTried = useRef(false);

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

  // One queue per provider, run side by side: every provider line takes a
  // single connection, so a provider's streams go one at a time, but two
  // providers don't need to wait on each other -- the probe locks per
  // provider (mediabox-infra stream-probe.py). In rank order within each.
  useEffect(() => {
    if (!verify || !streams || streams.length === 0) return;
    const ids = streamsToVerify(streams);
    const ctrl = new AbortController();
    // Queued shows nothing, so this is only published with the first check.
    let states: Record<number, VerifyState> = Object.fromEntries(ids.map((id) => [id, { status: "queued" } as VerifyState]));
    const providerOf = (id: number) => streams.find((s) => s.id === id)?.provider ?? "?";
    const queues = new Map<string, number[]>();
    for (const id of ids) queues.set(providerOf(id), [...(queues.get(providerOf(id)) ?? []), id]);
    const runQueue = async (queue: number[]) => {
      for (const id of queue) {
        if (ctrl.signal.aborted) return;
        if (states[id]?.status !== "queued") continue; // already settled, e.g. its provider is busy
        states = { ...states, [id]: { status: "checking" } };
        setChecks(states);
        let result = normalizeProbe({ status: "error", reason: "the check did not finish" });
        // "Busy" is often the provider still counting the probe's own last
        // pull for a few seconds: on 2026-10-18 that refused every feed for
        // Man Utd at Leeds and the page fell back to a guess. Ask again
        // before believing it.
        for (let attempt = 0; attempt < BUSY_RETRIES + 1; attempt++) {
          try {
            const res = await fetch(`/api/live/game-streams/verify?streamId=${id}`, { cache: "no-store", signal: ctrl.signal });
            result = normalizeProbe(res.ok ? await res.json() : { status: "error", reason: `HTTP ${res.status}` });
          } catch {
            if (ctrl.signal.aborted) return;
            result = normalizeProbe({ status: "error", reason: "the check did not finish" });
          }
          if (result.status !== "busy" || attempt === BUSY_RETRIES) break;
          await new Promise((r) => setTimeout(r, BUSY_RETRY_MS));
          if (ctrl.signal.aborted) return;
        }
        states = applyResult(states, streams, id, result);
        setChecks(states);
      }
    };
    for (const queue of queues.values()) void runQueue(queue);
    return () => ctrl.abort();
  }, [verify, streams]);

  useEffect(() => {
    if (!autoAdd || autoTried.current || !streams) return;
    const eligible = streams.filter(
      (s) => (!autoAddDatedOnly || s.dated) && (!autoAddEnglishOnly || feedLanguageRank(s.name) === 0)
    );
    const pick = pickAutoAdd(eligible, checks, autoAddMaxScore);
    if (!pick) {
      // Nothing to add yet. The player holds its guess only while a stream
      // that *could* be added is still being checked -- one that names the
      // game well enough (autoAddMaxScore) -- not for the whole list: a
      // radio station or a documentary channel can never be the pick, so
      // waiting on its check would only delay the guess.
      const settled = (id: number) => {
        const s = checks[id]?.status;
        return s !== undefined && s !== "queued" && s !== "checking";
      };
      const couldAdd = new Set(eligible.filter((c) => c.score != null && c.score <= autoAddMaxScore).map((c) => c.id));
      const ids = verify ? streamsToVerify(streams).filter((id) => couldAdd.has(id)) : [];
      const checked = ids.filter(settled).length;
      if (checked === ids.length) {
        // Nothing left that could change the answer: tell the player it can
        // stop holding for a feed and play its best guess.
        autoTried.current = true;
        announceGameFeedSearch({ fixtureId, outcome: "none" });
        return;
      }
      // Still checking: how far along, so the player keeps holding (every
      // candidate is checked before a guess plays) and can say so.
      announceGameFeedSearch({ fixtureId, outcome: "checking", progress: { checked, total: ids.length } });
      return;
    }
    autoTried.current = true;
    // Adding takes a while (Jellyfin lists it, then it is tuned once to warm
    // it up): tell the player what was found so it keeps holding and says so.
    announceGameFeedSearch({ fixtureId, outcome: "adding", name: pick.name });
    void add(pick, true)
      .catch(() => false)
      .then((ok) => {
        // "added" (with the channel) was announced by add(); only a miss is news here.
        if (!ok) announceGameFeedSearch({ fixtureId, outcome: "none" });
      });
    // add is recreated each render; the pick only depends on these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAdd, autoAddMaxScore, autoAddDatedOnly, autoAddEnglishOnly, streams, checks, verify]);

  async function add(s: Candidate, auto = false): Promise<boolean> {
    if (adding !== null || !canAdd(checks[s.id])) return false;
    setAdding(s.id);
    try {
      const res = await fetch("/api/live/streams/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // fixtureId marks it as a one-game channel, removed after the game.
        body: JSON.stringify({ streamId: s.id, name: s.name, logoUrl: s.logoUrl, fixtureId, auto }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        note?: string;
        existing?: boolean;
        ready?: boolean;
        jellyfinId?: string | null;
      };
      const okNote = auto ? "Added automatically. It joins the list above in a few seconds." : "Added. It joins the list above in a few seconds.";
      setAdded((a) => ({ ...a, [s.id]: res.ok ? (body.existing && body.note) || okNote : body.error ?? "Couldn't add it." }));
      // Jellyfin picks the new channel up on its guide refresh, which the
      // promote route starts; give it a moment, then reload the options.
      // The route answers once Jellyfin lists the channel (ready), or it was
      // already there (existing): switch now. Otherwise give the guide
      // refresh its old head start.
      if (res.ok) {
        // Straight to the player and the list -- no reload to wait for. The
        // refresh after only fills in what the page knows about it.
        if (body.jellyfinId) {
          announceGameFeedSearch({ fixtureId, outcome: "added", channel: { id: body.jellyfinId, name: s.name }, manual: !auto });
        }
        if (body.ready || body.existing) router.refresh();
        else setTimeout(() => router.refresh(), 8000);
      }
      return res.ok;
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
