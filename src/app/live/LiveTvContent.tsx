"use client";

import { useMemo, useState } from "react";
import { CHANNEL_CATEGORIES, classifyChannel, type LiveChannel } from "@/lib/liveTv";
import { ChannelCard } from "@/components/ChannelCard";
import { StreamBrowser } from "@/components/StreamBrowser";
import { SportsSchedule } from "@/components/SportsSchedule";
import { ROW_H2_CLASS } from "@/lib/browseLayout";

type HiddenEntry = { channelId: string; name: string };

type Props = {
  /** JELLYFIN_URL/JELLYFIN_API_KEY are set. */
  envSet: boolean;
  /** Jellyfin actually answered a probe -- the server is up, not just configured. */
  reachable: boolean;
  channels: LiveChannel[];
  /** The fetch hit its cap -- there are more channels than are shown. */
  truncated: boolean;
  /** Channel ids on this viewer's My List. Pinned above everything else. */
  myListIds: string[];
  /** Channels this viewer has hidden from their lineup, name-snapshotted. */
  hiddenChannels: HiddenEntry[];
  /** Gates the stream browser: adding a channel publishes it to everyone. */
  isAdmin: boolean;
};

/** Rendered at once. Enough to scroll, few enough to stay responsive. */
const PAGE_SIZE = 60;

/** Leading numeric run of a channel number ("7.1" -> 7.1, "WGN" -> NaN). */
function numberValue(number: string | null): number {
  if (!number) return NaN;
  const m = number.match(/^\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

export function LiveTvContent({
  envSet, reachable, channels, truncated, myListIds, hiddenChannels, isAdmin,
}: Props) {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [sortBy, setSortBy] = useState<"name" | "number">("name");
  const [category, setCategory] = useState<string>("all");

  const [hidden, setHidden] = useState<HiddenEntry[]>(hiddenChannels);
  const [hiddenPanelOpen, setHiddenPanelOpen] = useState(false);
  const [unhiding, setUnhiding] = useState<string | null>(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hiding, setHiding] = useState(false);

  const hiddenIds = useMemo(() => new Set(hidden.map((h) => h.channelId)), [hidden]);
  const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  // Computed once over the whole lineup rather than per render of a card:
  // classifying 1,477 names on every keystroke is wasted work.
  const categoryById = useMemo(
    () => new Map(channels.map((c) => [c.id, classifyChannel(c.name)])),
    [channels]
  );

  // Only offer categories this lineup actually has, with counts. An empty
  // "Kids" option that filters to nothing is worse than no option.
  const availableCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const cat of categoryById.values()) {
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return [...CHANNEL_CATEGORIES, "Other"]
      .filter((c) => (counts.get(c) ?? 0) > 0)
      .map((c) => ({ name: c, count: counts.get(c)! }));
  }, [categoryById]);

  const sorted = useMemo(() => {
    const arr = [...channels];
    if (sortBy === "number") {
      arr.sort((a, b) => {
        const an = numberValue(a.number);
        const bn = numberValue(b.number);
        if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
        if (!Number.isNaN(an)) return -1;
        if (!Number.isNaN(bn)) return 1;
        return a.name.localeCompare(b.name);
      });
    } else {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    }
    return arr;
  }, [channels, sortBy]);

  const unfilteredVisible = useMemo(
    () =>
      sorted.filter(
        (c) =>
          !hiddenIds.has(c.id) &&
          (category === "all" || categoryById.get(c.id) === category)
      ),
    [sorted, hiddenIds, category, categoryById]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return unfilteredVisible;
    // Number as well as name: on a broadcast lineup people reach for "7.1"
    // as readily as for the call sign.
    return unfilteredVisible.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.number ?? "").toLowerCase().includes(q) ||
        (c.now?.name ?? "").toLowerCase().includes(q)
    );
  }, [unfilteredVisible, query]);

  const listed = new Set(myListIds);
  // Pinned above the rest, and excluded from search so it stays a stable
  // shelf rather than disappearing the moment someone types. Left out of
  // bulk-hide on purpose -- favorites are managed with the star button, and
  // mixing the two actions on the same shelf invites hiding something you
  // just starred.
  const mine = channels.filter((c) => listed.has(c.id) && !hiddenIds.has(c.id));
  const visible = filtered.slice(0, shown);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function hideSelected() {
    const entries = [...selectedIds]
      .map((id) => channelById.get(id))
      .filter((c): c is LiveChannel => !!c)
      .map((c) => ({ channelId: c.id, name: c.name }));
    if (entries.length === 0) return;
    setHiding(true);
    try {
      const res = await fetch("/api/live/hidden", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels: entries }),
      });
      if (res.ok) {
        setHidden((prev) => [
          ...prev,
          ...entries.filter((e) => !prev.some((p) => p.channelId === e.channelId)),
        ]);
        exitSelectMode();
      }
    } finally {
      setHiding(false);
    }
  }

  async function unhide(channelId: string) {
    setUnhiding(channelId);
    try {
      const res = await fetch(`/api/live/hidden?channelId=${encodeURIComponent(channelId)}`, {
        method: "DELETE",
      });
      if (res.ok) setHidden((prev) => prev.filter((h) => h.channelId !== channelId));
    } finally {
      setUnhiding(null);
    }
  }

  // The three states are deliberately distinguished. "Jellyfin is unreachable",
  // "Jellyfin is fine but has no tuner", and "there's a tuner but it returned
  // nothing" have completely different fixes, and collapsing them into one
  // empty state is what makes a feature feel broken rather than unconfigured.
  let empty: { title: string; detail: React.ReactNode } | null = null;
  if (!envSet) {
    empty = {
      title: "Live TV isn’t configured",
      detail: (
        <>
          <code className="text-white/70">JELLYFIN_URL</code> or{" "}
          <code className="text-white/70">JELLYFIN_API_KEY</code> is unset on the server.
        </>
      ),
    };
  } else if (!reachable) {
    // Distinct from "no tuner" on purpose. Reporting a downed server as a
    // missing tuner sends you to check the wrong thing entirely.
    empty = {
      title: "Jellyfin isn’t responding",
      detail:
        "Streamy is configured for Jellyfin but the server isn’t answering. " +
        "Check that the Jellyfin container is running.",
    };
  } else if (channels.length === 0) {
    // Deliberately one state, not two. Telling "no tuner" apart from "tuner
    // that hasn't scanned" needs a signal Jellyfin doesn't cheaply expose, and
    // guessing at one is what produced a confidently wrong message before.
    empty = {
      title: "No channels",
      detail: (
        <>
          Jellyfin is running but returned no channels. Check that a tuner is added under{" "}
          <span className="text-white/70">Dashboard → Live TV → Tuner Devices</span>, and that
          it has finished scanning.
        </>
      ),
    };
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h1 className={ROW_H2_CLASS}>Live TV</h1>
        {channels.length > 0 && (
          <span className="text-sm text-white/40">
            {query ? `${filtered.length} of ${unfilteredVisible.length}` : `${unfilteredVisible.length} channel${unfilteredVisible.length === 1 ? "" : "s"}`}
            {truncated && !query ? "+" : ""}
          </span>
        )}
      </div>

      {channels.length > 0 && !empty && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {channels.length > PAGE_SIZE && (
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                // Reset paging here rather than in an effect: it is a consequence
                // of the edit, not of the render. Without it the reveal count from
                // the previous search carries over and results look arbitrarily
                // long.
                setShown(PAGE_SIZE);
              }}
              placeholder="Search channels…"
              // text-base on mobile: iOS zooms the viewport on a focused input
              // under 16px and there is no way back out without pinching.
              className="min-w-0 flex-1 rounded border border-white/15 bg-black/40 px-3 py-2 text-base text-white placeholder-white/30 focus:border-white/40 focus:outline-none sm:text-sm"
            />
          )}

          {availableCategories.length > 1 && (
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setShown(PAGE_SIZE);
              }}
              className="streamy-select shrink-0 rounded border border-white/15 bg-black/40 py-2 pl-3 text-sm text-white focus:border-white/40 focus:outline-none"
              aria-label="Filter channels by type"
            >
              <option value="all">All types</option>
              {availableCategories.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.count})
                </option>
              ))}
            </select>
          )}

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "name" | "number")}
            className="streamy-select shrink-0 rounded border border-white/15 bg-black/40 py-2 pl-3 text-sm text-white focus:border-white/40 focus:outline-none"
            aria-label="Sort channels"
          >
            <option value="name">Sort: Name</option>
            <option value="number">Sort: Channel #</option>
          </select>

          {!selectMode ? (
            <button
              type="button"
              onClick={() => setSelectMode(true)}
              className="shrink-0 rounded bg-white/10 px-3 py-2 text-sm text-white transition-colors hover:bg-white/20"
            >
              Select
            </button>
          ) : (
            <button
              type="button"
              onClick={exitSelectMode}
              className="shrink-0 rounded bg-white/10 px-3 py-2 text-sm text-white transition-colors hover:bg-white/20"
            >
              Cancel
            </button>
          )}

          {hidden.length > 0 && (
            <button
              type="button"
              onClick={() => setHiddenPanelOpen((v) => !v)}
              className="shrink-0 rounded bg-white/10 px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/20"
            >
              Hidden ({hidden.length})
            </button>
          )}
        </div>
      )}

      {selectMode && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-white/15 bg-netflix-dark/80 px-4 py-3">
          <span className="text-sm text-white/70">
            {selectedIds.size} selected
          </span>
          <button
            type="button"
            onClick={hideSelected}
            disabled={selectedIds.size === 0 || hiding}
            className="ml-auto rounded bg-netflix-red px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-netflix-red/80 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {hiding ? "Hiding…" : `Hide selected`}
          </button>
        </div>
      )}

      {hiddenPanelOpen && hidden.length > 0 && (
        <div className="mb-6 rounded-lg border border-white/10 bg-netflix-dark/60 p-4">
          <h2 className="mb-3 text-sm font-semibold text-white/80">Hidden channels</h2>
          <ul className="space-y-2">
            {hidden.map((h) => (
              <li key={h.channelId} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-white/70">{h.name}</span>
                <button
                  type="button"
                  onClick={() => unhide(h.channelId)}
                  disabled={unhiding === h.channelId}
                  className="shrink-0 rounded bg-white/10 px-2.5 py-1 text-xs text-white transition-colors hover:bg-white/20 disabled:opacity-50"
                >
                  {unhiding === h.channelId ? "…" : "Unhide"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {empty ? (
        <div className="rounded-lg border border-white/10 bg-netflix-dark/60 px-4 py-10 text-center">
          <p className="text-base font-semibold text-white/80">{empty.title}</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/50">{empty.detail}</p>
        </div>
      ) : (
        <>
          {mine.length > 0 && !query && !selectMode && (
            <section className="mb-8">
              <h2 className="mb-3 font-display text-xl font-bold text-white">My Stations</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {mine.map((c) => (
                  <ChannelCard key={`mine:${c.id}`} channel={c} inList />
                ))}
              </div>
            </section>
          )}

          {mine.length > 0 && !query && !selectMode && (
            <h2 className="mb-3 font-display text-xl font-bold text-white">All Channels</h2>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((c) => (
              <ChannelCard
                key={c.id}
                channel={c}
                inList={listed.has(c.id)}
                selectMode={selectMode}
                selected={selectedIds.has(c.id)}
                onToggleSelect={() => toggleSelect(c.id)}
              />
            ))}
          </div>

          {filtered.length === 0 && (
            <p className="py-10 text-center text-sm text-white/40">
              No channels match “{query}”.
            </p>
          )}

          {shown < filtered.length && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setShown((n) => n + PAGE_SIZE)}
                className="rounded bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/20"
              >
                Show {Math.min(PAGE_SIZE, filtered.length - shown)} more
              </button>
            </div>
          )}

          {truncated && !query && shown >= filtered.length && (
            // Said out loud rather than silently cutting the list off, which
            // is what the old hard cap did.
            <p className="mt-4 text-center text-xs text-white/30">
              Showing the first {channels.length} channels. Your tuner reports more —
              narrow the playlist in Jellyfin if you need the rest.
            </p>
          )}
        </>
      )}

      {/*
        Admin only, and below the lineup rather than beside it: this is a
        maintenance surface, not something a viewer scrolls past on the way to
        watching something. Rendered even when the tuner is unreachable, since
        an empty lineup is exactly when someone wants to add to it.
      */}
      {/* Everyone, not admin-gated like the browser below: "what's on
          tonight" is exactly the audience Live TV itself has. */}
      <SportsSchedule />

      {isAdmin && <StreamBrowser />}
    </div>
  );
}
