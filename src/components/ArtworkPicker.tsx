"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { LibraryGame } from "@/lib/gamarr";
import type { ArtworkCandidate, ArtworkKind, SgdbGame } from "@/lib/steamgriddb";
import { romSearchTitle } from "@/lib/romNames";

const KINDS: { id: ArtworkKind; label: string; hint: string }[] = [
  { id: "grid", label: "Cover", hint: "Portrait tile in the Steam library" },
  { id: "hero", label: "Banner", hint: "Wide image on the game's page" },
  { id: "logo", label: "Logo", hint: "Transparent title treatment" },
  { id: "icon", label: "Icon", hint: "Small icon in lists" },
];

// Both fetches below follow the same shape, and it's deliberate: the result
// carries the inputs it was fetched for, so "still loading" is *derived* by
// comparing it against the current inputs rather than tracked in its own
// state. That keeps every setState inside an async callback -- no synchronous
// setState in an effect body, which the React Compiler lint rejects outright
// (and rightly: it cascades renders) -- and it makes a stale in-flight
// response impossible to mistake for a fresh one.
type GamesResult = { term: string; games: SgdbGame[] | null; error: string | null };
type ArtResult = {
  gameId: number;
  kind: ArtworkKind;
  candidates: ArtworkCandidate[] | null;
  error: string | null;
};

export function ArtworkPicker({
  game,
  onClose,
}: {
  game: LibraryGame;
  onClose: () => void;
}) {
  const initialTerm = romSearchTitle(game.romStem);
  // What's typed in the box vs. what's actually being searched for. The
  // effect keys off `activeTerm`, so a click/Enter is just "set the term" --
  // the fetch is the effect's job, not the handler's.
  const [term, setTerm] = useState(initialTerm);
  const [activeTerm, setActiveTerm] = useState(initialTerm);
  const [gamesResult, setGamesResult] = useState<GamesResult | null>(null);
  const [selectedGame, setSelectedGame] = useState<SgdbGame | null>(null);
  const [kind, setKind] = useState<ArtworkKind>("grid");
  const [artResult, setArtResult] = useState<ArtResult | null>(null);
  const [saving, setSaving] = useState<number | "clear" | null>(null);
  const [savedKinds, setSavedKinds] = useState<Set<ArtworkKind>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);

  const gamesLoading = gamesResult?.term !== activeTerm;
  const games = gamesLoading ? null : gamesResult?.games;
  const gamesError = gamesLoading ? null : (gamesResult?.error ?? null);

  const artLoading =
    !!selectedGame && (artResult?.gameId !== selectedGame.id || artResult?.kind !== kind);
  const candidates = artLoading ? null : artResult?.candidates;
  const artError = artLoading ? null : (artResult?.error ?? null);

  // Resolve the ROM title to SteamGridDB games. Runs on open and on every
  // re-search; state is only ever set from inside the promise chain.
  useEffect(() => {
    if (!activeTerm.trim()) return;
    let cancelled = false;
    fetch(`/api/admin/games/artwork?mode=games&q=${encodeURIComponent(activeTerm.trim())}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return;
        const found: SgdbGame[] = d?.games ?? [];
        setGamesResult({
          term: activeTerm,
          games: ok ? found : null,
          error: ok ? null : (d?.error ?? "Lookup failed"),
        });
        // A single obvious match is the overwhelmingly common case; making
        // someone click it before seeing any art would be pure ceremony.
        setSelectedGame(ok && found.length === 1 ? found[0] : null);
      })
      .catch(() => {
        if (cancelled) return;
        setGamesResult({
          term: activeTerm,
          games: null,
          error: "Lookup failed — couldn't reach SteamGridDB.",
        });
        setSelectedGame(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTerm]);

  // Candidates for the chosen game + asset kind.
  useEffect(() => {
    if (!selectedGame) return;
    let cancelled = false;
    const gameId = selectedGame.id;
    fetch(`/api/admin/games/artwork?mode=art&gameId=${gameId}&kind=${kind}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return;
        setArtResult({
          gameId,
          kind,
          candidates: ok ? (d?.candidates ?? []) : null,
          error: ok ? null : (d?.error ?? "Couldn't load artwork"),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setArtResult({ gameId, kind, candidates: null, error: "Couldn't load artwork." });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedGame, kind]);

  // Escape closes, matching the rest of Streamy's overlays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(candidate: ArtworkCandidate | null) {
    setSaving(candidate ? candidate.id : "clear");
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/games/artwork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: game.system,
          romStem: game.romStem,
          kind,
          imageUrl: candidate?.url ?? null,
          sgdbGameId: selectedGame?.id ?? null,
          title: romSearchTitle(game.romStem),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data?.error ?? "Couldn't save that choice");
        return;
      }
      setSavedKinds((prev) => {
        const next = new Set(prev);
        if (candidate) next.add(kind);
        else next.delete(kind);
        return next;
      });
    } catch {
      setSaveError("Couldn't save that choice.");
    } finally {
      setSaving(null);
    }
  }

  const error = saveError ?? gamesError ?? artError;
  const loading = gamesLoading || artLoading;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-white/10 bg-netflix-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-white">{game.fileName}</h3>
            <p className="text-xs text-white/40">
              {game.platform || game.system}
              {savedKinds.size > 0 && (
                <span className="ml-2 text-emerald-400/80">
                  {savedKinds.size} asset{savedKinds.size === 1 ? "" : "s"} set
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-sm text-white/50 hover:text-white"
          >
            Done
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex gap-2">
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setActiveTerm(term);
              }}
              placeholder="Search SteamGridDB…"
              className="min-w-0 flex-1 rounded border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/30 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setActiveTerm(term)}
              className="rounded border border-white/20 px-3 py-2 text-sm text-white/80 hover:border-white/40 hover:text-white"
            >
              Find
            </button>
          </div>

          {games && games.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {games.slice(0, 8).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setSelectedGame(g)}
                  className={`rounded border px-2.5 py-1 text-xs transition-colors ${
                    selectedGame?.id === g.id
                      ? "border-netflix-red bg-netflix-red/15 text-white"
                      : "border-white/15 text-white/60 hover:border-white/30 hover:text-white"
                  }`}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}

          {games?.length === 0 && (
            <p className="text-sm text-white/50">
              No SteamGridDB match. Try the game&apos;s plain title without region or version tags.
            </p>
          )}

          {selectedGame && (
            <div className="flex flex-wrap gap-1.5 border-t border-white/10 pt-4">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setKind(k.id)}
                  title={k.hint}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    kind === k.id
                      ? "bg-white/15 text-white"
                      : "text-white/50 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {k.label}
                  {savedKinds.has(k.id) && <span className="ml-1 text-emerald-400">•</span>}
                </button>
              ))}
            </div>
          )}

          {error && (
            <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          {loading && <p className="text-sm text-white/50">Loading…</p>}

          {candidates?.length === 0 && (
            <p className="text-sm text-white/50">
              No {KINDS.find((k) => k.id === kind)?.label.toLowerCase()} art available for this
              game on SteamGridDB.
            </p>
          )}

          {candidates && candidates.length > 0 && (
            <>
              <div
                className={`grid gap-3 ${
                  kind === "grid"
                    ? "grid-cols-3 sm:grid-cols-4"
                    : kind === "icon"
                      ? "grid-cols-5 sm:grid-cols-8"
                      : "grid-cols-2 sm:grid-cols-3"
                }`}
              >
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => save(c)}
                    disabled={saving !== null}
                    className="group relative overflow-hidden rounded border border-white/10 transition-colors hover:border-netflix-red disabled:opacity-50"
                    style={{
                      aspectRatio: kind === "grid" ? "2 / 3" : kind === "icon" ? "1 / 1" : "16 / 9",
                    }}
                  >
                    <Image
                      src={c.thumb}
                      alt=""
                      fill
                      // Thumbnails in a dense grid -- `unoptimized` keeps this
                      // from pushing dozens of one-off SteamGridDB images
                      // through the optimizer's cache for a pick-once flow.
                      unoptimized
                      className="object-cover"
                      sizes="(max-width: 640px) 33vw, 200px"
                    />
                    {saving === c.id && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-white">
                        Saving…
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {savedKinds.has(kind) && (
                <button
                  type="button"
                  onClick={() => save(null)}
                  disabled={saving !== null}
                  className="text-xs text-white/40 underline-offset-2 hover:text-white hover:underline disabled:opacity-50"
                >
                  Clear this override and let the Deck choose automatically
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
