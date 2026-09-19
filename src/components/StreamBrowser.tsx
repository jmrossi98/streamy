"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CHANNEL_CATEGORIES, classifyChannel } from "@/lib/liveTv";

type Stream = {
  id: number;
  name: string;
  logoUrl: string | null;
  groupId: number | null;
  suggestedNumber: number | null;
  stale: boolean;
};

/**
 * Browses everything the providers carry, and promotes any of it into the
 * lineup.
 *
 * Dispatcharr holds 4,150 streams; five were published. The rest were reachable
 * only through Dispatcharr's own admin UI, which is a separate login on a
 * different box -- so in practice the catalogue may as well not have existed.
 *
 * Search is server-side and categories are not, and that split is deliberate.
 * Searching 4,150 rows in the browser would mean shipping the whole catalogue
 * per keystroke; Dispatcharr already indexes it. Categories are inferred from
 * the name by the same classifyChannel the channel grid uses, so they can only
 * ever apply to rows already loaded -- which is why the count says "in these
 * results" rather than implying it searched everything.
 */
export function StreamBrowser() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [streams, setStreams] = useState<Stream[]>([]);
  const [promotedIds, setPromotedIds] = useState<Set<number>>(new Set());
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Guards against an older search landing after a newer one. Typing "nfl"
  // fires three requests and they do not necessarily return in order.
  const requestSeq = useRef(0);

  const load = useCallback(async (q: string, p: number) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/live/streams?q=${encodeURIComponent(q)}&page=${p}`
      );
      if (seq !== requestSeq.current) return;
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Couldn't load streams.");
        setStreams([]);
        return;
      }
      const data = (await res.json()) as {
        items: Stream[];
        total: number;
        promotedIds: number[];
      };
      if (seq !== requestSeq.current) return;
      setStreams(data.items);
      setTotal(data.total);
      setPromotedIds(new Set(data.promotedIds));
    } catch {
      if (seq === requestSeq.current) setError("Couldn't load streams.");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  // Debounced: this reaches across the tailnet to the home server, and a
  // request per keystroke is both slow and pointless.
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      void load(query, 1);
    }, 300);
    return () => clearTimeout(t);
  }, [query, load]);

  const categoryOf = useMemo(
    () => new Map(streams.map((s) => [s.id, classifyChannel(s.name)])),
    [streams]
  );

  const visible = useMemo(
    () =>
      category === "all"
        ? streams
        : streams.filter((s) => categoryOf.get(s.id) === category),
    [streams, category, categoryOf]
  );

  // Only categories present in what is loaded, with counts. An empty option
  // that filters to nothing is worse than no option.
  const availableCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of categoryOf.values()) counts.set(c, (counts.get(c) ?? 0) + 1);
    return [...CHANNEL_CATEGORIES, "Other"]
      .filter((c) => (counts.get(c) ?? 0) > 0)
      .map((c) => ({ name: c, count: counts.get(c)! }));
  }, [categoryOf]);

  async function promote(stream: Stream) {
    if (busyId !== null) return;
    setBusyId(stream.id);
    setNote(null);
    try {
      const res = await fetch("/api/live/streams/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          streamId: stream.id,
          name: stream.name,
          logoUrl: stream.logoUrl,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; channelNumber?: number; note?: string }
        | null;
      if (!res.ok) {
        setNote(body?.error ?? "Couldn't add that stream.");
        return;
      }
      // Marked locally rather than refetching: the list is paged and a refetch
      // would scroll the reader back to the top of it.
      setPromotedIds((prev) => new Set(prev).add(stream.id));
      setNote(
        `Added “${stream.name}” as channel ${body?.channelNumber ?? "?"}. ` +
          "It appears in Live TV once Jellyfin refreshes its guide."
      );
    } catch {
      setNote("Couldn't add that stream.");
    } finally {
      setBusyId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <section className="mt-10">
      <h2 className="streamy-page-title-x mb-1 font-display text-2xl font-bold text-white">
        Browse all streams
      </h2>
      <p className="streamy-page-title-x mb-4 text-sm text-white/50">
        Everything your providers carry. Adding one publishes it to Live TV for
        everyone.
      </p>

      <div className="streamy-page-title-x mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search 4,000+ streams — try NFL, NBA, Arsenal…"
          className="min-w-0 flex-1 rounded border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-netflix-red focus:outline-none"
        />
        {total > 0 && (
          <span className="shrink-0 text-xs tabular-nums text-white/40">
            {total.toLocaleString()} match{total === 1 ? "" : "es"}
          </span>
        )}
      </div>

      {availableCategories.length > 0 && (
        <div className="streamy-page-title-x mb-4 flex flex-wrap gap-2">
          <CategoryChip
            label="All"
            active={category === "all"}
            onClick={() => setCategory("all")}
          />
          {availableCategories.map((c) => (
            <CategoryChip
              key={c.name}
              label={`${c.name} (${c.count})`}
              active={category === c.name}
              onClick={() => setCategory(c.name)}
            />
          ))}
        </div>
      )}

      {note && (
        <p
          className="streamy-page-title-x mb-3 rounded bg-white/10 px-3 py-2 text-sm text-white/80"
          role="status"
        >
          {note}
        </p>
      )}
      {error && (
        <p className="streamy-page-title-x mb-3 text-sm text-red-400">{error}</p>
      )}

      {loading && streams.length === 0 ? (
        <p className="streamy-page-title-x text-sm text-white/40">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="streamy-page-title-x text-sm text-white/40">
          {streams.length === 0
            ? "No streams match that search."
            : "No streams in that category on this page."}
        </p>
      ) : (
        <ul className="streamy-page-title-x space-y-1">
          {visible.map((s) => {
            const added = promotedIds.has(s.id);
            return (
              <li
                key={s.id}
                className="flex items-center gap-3 rounded bg-white/5 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white/90">{s.name}</p>
                  <p className="text-xs text-white/40">
                    {categoryOf.get(s.id)}
                    {/* Dispatcharr's own judgement, surfaced rather than
                        hidden: two of the five already-published channels have
                        dead upstreams, and adding more of those is how "live
                        TV is broken" gets reported when one channel is. */}
                    {s.stale && (
                      <span className="ml-2 text-amber-400/80">
                        · provider reports this stream as dead
                      </span>
                    )}
                  </p>
                </div>
                {added ? (
                  <span className="shrink-0 rounded bg-white/10 px-2 py-1 text-xs text-white/50">
                    In lineup
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => promote(s)}
                    disabled={busyId !== null}
                    className="shrink-0 rounded bg-netflix-red px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                  >
                    {busyId === s.id ? "Adding…" : "Add channel"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="streamy-page-title-x mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => {
              const p = page - 1;
              setPage(p);
              void load(query, p);
            }}
            className="rounded border border-white/20 px-3 py-1.5 text-xs text-white transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs tabular-nums text-white/40">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => {
              const p = page + 1;
              setPage(p);
              void load(query, p);
            }}
            className="rounded border border-white/20 px-3 py-1.5 text-xs text-white transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs transition-colors ${
        active
          ? "bg-white text-netflix-black font-semibold"
          : "bg-white/10 text-white/70 hover:bg-white/20"
      }`}
    >
      {label}
    </button>
  );
}
