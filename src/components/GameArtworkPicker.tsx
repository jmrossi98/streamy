"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { ArtworkCandidate, ArtworkKind, SgdbGame } from "@/lib/steamgriddb";
import { romSearchTitle } from "@/lib/romNames";

const KINDS: { id: ArtworkKind; label: string; hint: string }[] = [
  { id: "grid", label: "Cover", hint: "Portrait tile shown everywhere in Streamy and Steam" },
  { id: "hero", label: "Banner", hint: "Wide image on the game's page" },
  { id: "logo", label: "Logo", hint: "Transparent title treatment" },
  { id: "icon", label: "Icon", hint: "Small icon in lists" },
];

// Same shape as the fetch effects below: the result carries the inputs it
// was fetched for, so "loading" is derived by comparing it against current
// inputs rather than tracked in its own state -- keeps every setState inside
// an async callback (React Compiler rejects a synchronous setState in an
// effect body outright).
type GamesResult = { term: string; games: SgdbGame[] | null; error: string | null };
type ArtResult = {
  gameId: number;
  kind: ArtworkKind;
  candidates: ArtworkCandidate[] | null;
  error: string | null;
};

export type GameArtworkPickerProps = {
  system: string;
  romStem: string;
  /** Which kinds already have a saved pick, so the tab strip and initial
   *  "cleared" affordance reflect real state on load, not just this session. */
  savedKinds: ArtworkKind[];
  /** The actual saved image URL per kind, so a matching candidate tile can
   *  show a "this one's picked" outline instead of leaving every tile
   *  looking identical once you've already chosen one. */
  initialArtwork?: Partial<Record<ArtworkKind, string>>;
  /** Fired the instant a save succeeds, so a parent preview (banner/cover/
   *  logo/icon laid out together) can update without a page reload. */
  onArtworkSaved?: (kind: ArtworkKind, url: string | null) => void;
};

/**
 * Inline (not modal) artwork picker for a game's detail page -- pick from
 * real SteamGridDB candidates for all four Steam asset kinds. Saving here
 * updates the game's poster everywhere in Streamy immediately (the games
 * grid and My List read the same saved pick) and reaches the Steam Deck on
 * its next rom-auto-import.sh run via /api/games/artwork-overrides.
 */
export function GameArtworkPicker({
  system,
  romStem,
  savedKinds,
  initialArtwork,
  onArtworkSaved,
}: GameArtworkPickerProps) {
  const initialTerm = romSearchTitle(romStem);
  const [term, setTerm] = useState(initialTerm);
  const [activeTerm, setActiveTerm] = useState(initialTerm);
  const [gamesResult, setGamesResult] = useState<GamesResult | null>(null);
  const [selectedGame, setSelectedGame] = useState<SgdbGame | null>(null);
  const [kind, setKind] = useState<ArtworkKind>("grid");
  const [artResult, setArtResult] = useState<ArtResult | null>(null);
  const [saving, setSaving] = useState<number | "clear" | null>(null);
  const [saved, setSaved] = useState<Set<ArtworkKind>>(new Set(savedKinds));
  const [savedUrls, setSavedUrls] = useState<Partial<Record<ArtworkKind, string>>>(
    initialArtwork ?? {}
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  const gamesLoading = gamesResult?.term !== activeTerm;
  const games = gamesLoading ? null : gamesResult?.games;
  const gamesError = gamesLoading ? null : (gamesResult?.error ?? null);

  const artLoading =
    !!selectedGame && (artResult?.gameId !== selectedGame.id || artResult?.kind !== kind);
  const candidates = artLoading ? null : artResult?.candidates;
  const artError = artLoading ? null : (artResult?.error ?? null);

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
        if (ok && found.length === 1) setSelectedGame(found[0]);
      })
      .catch(() => {
        if (cancelled) return;
        setGamesResult({ term: activeTerm, games: null, error: "Lookup failed — couldn't reach SteamGridDB." });
        setSelectedGame(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTerm]);

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

  async function save(candidate: ArtworkCandidate | null) {
    setSaving(candidate ? candidate.id : "clear");
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/games/artwork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system,
          romStem,
          kind,
          imageUrl: candidate?.url ?? null,
          sgdbGameId: selectedGame?.id ?? null,
          title: initialTerm,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data?.error ?? "Couldn't save that choice");
        return;
      }
      setSaved((prev) => {
        const next = new Set(prev);
        if (candidate) next.add(kind);
        else next.delete(kind);
        return next;
      });
      setSavedUrls((prev) => {
        const next = { ...prev };
        if (candidate) next[kind] = candidate.url;
        else delete next[kind];
        return next;
      });
      onArtworkSaved?.(kind, candidate?.url ?? null);
    } catch {
      setSaveError("Couldn't save that choice.");
    } finally {
      setSaving(null);
    }
  }

  const error = saveError ?? gamesError ?? artError;
  const loading = gamesLoading || artLoading;

  return (
    <div className="space-y-4">
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
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                kind === k.id ? "bg-white/15 text-white" : "text-white/50 hover:bg-white/5 hover:text-white"
              }`}
            >
              {k.label}
              {saved.has(k.id) && <span className="ml-1.5 text-emerald-400">•</span>}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}

      {loading && <p className="text-sm text-white/50">Loading…</p>}

      {candidates?.length === 0 && (
        <p className="text-sm text-white/50">
          No {KINDS.find((k) => k.id === kind)?.label.toLowerCase()} art available for this game on SteamGridDB.
        </p>
      )}

      {candidates && candidates.length > 0 && (
        <>
          <div
            className={`grid gap-3 ${
              kind === "grid"
                ? "grid-cols-3 sm:grid-cols-5 md:grid-cols-6"
                : kind === "icon"
                  ? "grid-cols-6 sm:grid-cols-8 md:grid-cols-10"
                  : "grid-cols-2 sm:grid-cols-4"
            }`}
          >
            {candidates.map((c) => {
              const isChosen = savedUrls[kind] === c.url;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => save(c)}
                  disabled={saving !== null}
                  className={`group relative overflow-hidden rounded border-2 transition-colors disabled:opacity-50 ${
                    isChosen
                      ? "border-netflix-red"
                      : "border-white/10 hover:border-netflix-red/60"
                  }`}
                  style={{ aspectRatio: kind === "grid" ? "2 / 3" : kind === "icon" ? "1 / 1" : "16 / 9" }}
                >
                  <Image
                    src={c.thumb}
                    alt=""
                    fill
                    // Dense pick-once grid of one-off SteamGridDB thumbnails --
                    // not worth pushing through the image optimizer's cache.
                    unoptimized
                    className="object-cover"
                    sizes="(max-width: 640px) 33vw, 200px"
                  />
                  {isChosen && (
                    <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-netflix-red text-white shadow">
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    </span>
                  )}
                  {saving === c.id && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-white">
                      Saving…
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {saved.has(kind) && (
            <button
              type="button"
              onClick={() => save(null)}
              disabled={saving !== null}
              className="text-xs text-white/40 underline-offset-2 hover:text-white hover:underline disabled:opacity-50"
            >
              Clear this pick and let auto-matching choose instead
            </button>
          )}
        </>
      )}
    </div>
  );
}
