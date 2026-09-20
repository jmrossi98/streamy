"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CHANNEL_CATEGORIES, classifyChannel } from "@/lib/liveTv";
import { looksLikeEventFeed } from "@/lib/liveTimeline";

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
 *
 * Open to any signed-in viewer: searching and adding a channel is the same
 * "found something worth watching" action whoever does it, and the API
 * routes behind it (GET, promote) are open the same way. Only removing a
 * channel stays admin-gated -- both here (isAdmin hides the button) and on
 * the server (the demote route still checks requireAdmin) -- since taking a
 * channel away can interrupt someone else mid-game, a different and higher
 * blast radius than adding one.
 */
export function StreamBrowser({ isAdmin }: { isAdmin: boolean }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  /*
    Networks only, by default.

    Most of a 4,150-entry catalogue is one-off fixtures that are dead outside
    their event, and promoting one produces a channel that looks broken. The
    default therefore shows only what is recognisably a channel, with the rest
    one click away for when a specific game is genuinely what you want.
  */
  const [networksOnly, setNetworksOnly] = useState(true);
  const [streams, setStreams] = useState<Stream[]>([]);
  // Stream id -> the channel id publishing it. A Map rather than the Set this
  // used to be: demoting needs the channel id, not just "is this promoted".
  const [promoted, setPromoted] = useState<Map<number, number>>(new Map());
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Guards against an older search landing after a newer one. Typing "nfl"
  // fires three requests and they do not necessarily return in order.
  const requestSeq = useRef(0);

  const load = useCallback(async (q: string, p: number, netOnly: boolean) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/live/streams?q=${encodeURIComponent(q)}&page=${p}&networksOnly=${netOnly ? "1" : "0"}`
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
        promoted: [number, number][];
      };
      if (seq !== requestSeq.current) return;
      setStreams(data.items);
      setTotal(data.total);
      setPromoted(new Map(data.promoted));
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
      void load(query, 1, networksOnly);
    }, 300);
    return () => clearTimeout(t);
    // networksOnly deliberately excluded: its own toggle handler below reloads
    // immediately rather than waiting out this debounce, since it isn't typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, load]);

  const categoryOf = useMemo(
    () => new Map(streams.map((s) => [s.id, classifyChannel(s.name)])),
    [streams]
  );

  // Networks-only is now filtered server-side, before pagination -- see
  // listStreams(). What's loaded here is already the right set; only the
  // (unpaginated, load-more-costly-to-do-server-side) category slice happens
  // client-side, same as before.
  const visible = useMemo(() => {
    if (category === "all") return streams;
    return streams.filter((s) => categoryOf.get(s.id) === category);
  }, [streams, category, categoryOf]);

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
        | { error?: string; id?: number; channelNumber?: number; note?: string }
        | null;
      if (!res.ok) {
        setNote(body?.error ?? "Couldn't add that stream.");
        return;
      }
      // Marked locally rather than refetching: the list is paged and a refetch
      // would scroll the reader back to the top of it.
      if (typeof body?.id === "number") {
        setPromoted((prev) => new Map(prev).set(stream.id, body.id!));
      }
      // The server's own wording, not a guess: it knows whether Jellyfin
      // accepted the guide refresh, and "refreshing now" and "wait for the
      // next scheduled update" are very different promises to make.
      setNote(
        `Added “${stream.name}” as channel ${body?.channelNumber ?? "?"}. ` +
          (body?.note ?? "")
      );
    } catch {
      setNote("Couldn't add that stream.");
    } finally {
      setBusyId(null);
    }
  }

  async function demote(stream: Stream, channelId: number) {
    if (busyId !== null) return;
    setBusyId(stream.id);
    setNote(null);
    try {
      const res = await fetch("/api/live/streams/demote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId }),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; note?: string }
        | null;
      if (!res.ok) {
        setNote(body?.error ?? "Couldn't remove that channel.");
        return;
      }
      setPromoted((prev) => {
        const next = new Map(prev);
        next.delete(stream.id);
        return next;
      });
      setNote(`Removed “${stream.name}” from Live TV. ` + (body?.note ?? ""));
    } catch {
      setNote("Couldn't remove that channel.");
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

      <div className="streamy-page-title-x mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const next = !networksOnly;
            setNetworksOnly(next);
            setPage(1);
            void load(query, 1, next);
          }}
          className={`rounded-full px-3 py-1 text-xs transition-colors ${
            networksOnly
              ? "bg-white font-semibold text-netflix-black"
              : "bg-white/10 text-white/70 hover:bg-white/20"
          }`}
          aria-pressed={networksOnly}
        >
          Networks only
        </button>
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
            ? networksOnly
              ? "No recognised networks match that search — turn off “Networks only” to see one-off events."
              : "No streams match that search."
            : "No streams in that category on this page."}
        </p>
      ) : (
        <ul className="streamy-page-title-x space-y-1">
          {visible.map((s) => {
            const channelId = promoted.get(s.id);
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
                    {/* A one-off fixture rather than a channel. Promoting one
                        gives a channel that is dead outside the event, which
                        is indistinguishable from a broken channel -- both
                        sports channels added here before this warning existed
                        were reported as "won't stream", correctly. */}
                    {looksLikeEventFeed(s.name) && (
                      <span className="ml-2 text-amber-400/80">
                        · looks like a one-off event
                      </span>
                    )}
                  </p>
                </div>
                {channelId != null && isAdmin ? (
                  <button
                    type="button"
                    onClick={() => demote(s, channelId)}
                    disabled={busyId !== null}
                    title="Remove this channel from Live TV -- the stream stays in the catalogue"
                    className="shrink-0 rounded border border-white/20 px-3 py-1.5 text-xs text-white/60 transition-colors hover:border-red-400/50 hover:text-red-400 disabled:opacity-50"
                  >
                    {busyId === s.id ? "Removing…" : "Remove channel"}
                  </button>
                ) : channelId != null ? (
                  // Removing is admin-only (see the module doc comment) --
                  // a non-admin who already added this sees the same static
                  // badge StreamBrowser always showed before removal existed.
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
              void load(query, p, networksOnly);
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
              void load(query, p, networksOnly);
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
