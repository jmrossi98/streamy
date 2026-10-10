"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";

type Entry =
  | { kind: "movie"; movieId: string; title: string; at: string }
  | { kind: "episode"; showId: string; season: number; episode: number; title: string; at: string };

const keyOf = (e: Entry) => (e.kind === "movie" ? `m:${e.movieId}` : `e:${e.showId}:${e.season}:${e.episode}`);
const hrefOf = (e: Entry) => (e.kind === "movie" ? `/watch/${e.movieId}` : `/show/${e.showId}`);
const targetOf = (e: Entry) =>
  e.kind === "movie"
    ? { kind: e.kind, movieId: e.movieId }
    : { kind: e.kind, showId: e.showId, season: e.season, episode: e.episode };

// Rendered only after the fetch, so always in the browser: the viewer's own
// time zone and date order, with no server-rendered text to disagree with.
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * What this person has watched and when, with a way to remove an entry or
 * all of them. One entry per movie or episode, dated by its last watch.
 */
export function WatchHistory() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const load = useCallback(async (offset: number) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/history?offset=${offset}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { items: Entry[]; hasMore: boolean };
      setEntries((prev) => (offset === 0 || !prev ? data.items : [...prev, ...data.items]));
      setHasMore(data.hasMore);
    } catch {
      setError("Could not load your watch history.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(0);
  }, [load]);

  async function remove(body: object, after: () => void) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/history", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Could not remove that.");
      }
      after();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that.");
    } finally {
      setBusy(false);
    }
  }

  const removeOne = (e: Entry) =>
    remove(targetOf(e), () => setEntries((prev) => prev?.filter((x) => keyOf(x) !== keyOf(e)) ?? prev));

  const clearAll = () =>
    remove({ kind: "all" }, () => {
      setEntries([]);
      setHasMore(false);
      setConfirmingClear(false);
    });

  return (
    <div className="rounded-lg border border-white/10 bg-netflix-dark/80 px-4 py-4 sm:px-6">
      {error && (
        <p role="alert" className="mb-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {entries === null && !error && <p className="text-sm text-white/50">Loading…</p>}
      {entries?.length === 0 && <p className="text-sm text-white/50">Nothing watched yet.</p>}

      {entries && entries.length > 0 && (
        <>
          <ul className="divide-y divide-white/10">
            {entries.map((e) => (
              <li key={keyOf(e)} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link href={hrefOf(e)} className="block truncate text-sm text-white hover:underline">
                    {e.title}
                    {e.kind === "episode" && (
                      <span className="text-white/50">
                        {" "}
                        · S{e.season} E{e.episode}
                      </span>
                    )}
                  </Link>
                  <time dateTime={e.at} className="block text-xs text-white/45">
                    {when(e.at)}
                  </time>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void removeOne(e)}
                  aria-label={`Remove ${e.title}${e.kind === "episode" ? ` season ${e.season} episode ${e.episode}` : ""} from history`}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {hasMore && (
              <Button size="sm" disabled={busy} onClick={() => void load(entries.length)}>
                Show more
              </Button>
            )}
            <span className="flex-1" />
            {confirmingClear ? (
              <>
                <span className="text-xs text-white/60">Remove everything? This also resets where you left off.</span>
                <Button variant="danger" size="sm" disabled={busy} onClick={() => void clearAll()}>
                  Yes, clear it
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmingClear(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="danger" size="sm" disabled={busy} onClick={() => setConfirmingClear(true)}>
                Clear all history
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
