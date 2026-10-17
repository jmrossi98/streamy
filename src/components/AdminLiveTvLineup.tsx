"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { LiveChannel } from "@/lib/liveTv";
import { looksLikePlaceholder } from "@/lib/liveTimeline";
import type { ChannelInfo } from "@/lib/dispatcharr";
import type { ChannelVerdict } from "@/lib/liveChannelRules";
import { ChannelCard } from "@/components/ChannelCard";
import { Button, TextInput } from "@/components/ui";

type HiddenEntry = { channelId: string; name: string };

type Props = {
  envSet: boolean;
  reachable: boolean;
  channels: LiveChannel[];
  /** The admin's own hidden channels -- hiding is per viewer. */
  hiddenChannels: HiddenEntry[];
  infoByChannel: Record<string, ChannelInfo>;
  /** The same verdicts /live shows, so a dead or idle channel is badged here too. */
  statusByChannel?: Record<string, ChannelVerdict>;
  logoFallbacks: Record<string, string>;
};

/** Rendered at once. Enough to scroll, few enough to stay responsive. */
const PAGE_SIZE = 60;

/**
 * The lineup as a checklist: pick channels, then hide them (for yourself) or
 * delete them (for everyone). Lifted out of /live on 2026-10-16 with its
 * behaviour intact -- see AdminLiveTvPage for why it moved.
 *
 * Select mode is still a toggle rather than always on, because the cards are
 * links when it is off and opening a channel to check what it actually plays
 * is half of deciding whether to remove it.
 */
export function AdminLiveTvLineup({
  envSet, reachable, channels, hiddenChannels, infoByChannel, statusByChannel = {}, logoFallbacks,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);

  const [hidden, setHidden] = useState<HiddenEntry[]>(hiddenChannels);
  const [deleting, setDeleting] = useState(false);
  const [deleteNote, setDeleteNote] = useState<string | null>(null);
  const [unhiding, setUnhiding] = useState<string | null>(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hiding, setHiding] = useState(false);

  const hiddenIds = useMemo(() => new Set(hidden.map((h) => h.channelId)), [hidden]);
  const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  const sorted = useMemo(
    () =>
      channels
        .filter((c) => !looksLikePlaceholder(c.name) && !hiddenIds.has(c.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [channels, hiddenIds]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.number ?? "").toLowerCase().includes(q)
    );
  }, [sorted, query]);

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

  /**
   * Removes the selected channels from the lineup, for everybody.
   *
   * Deliberately distinct from Hide, which is per-viewer and reversible from
   * the Hidden channels list below. This one is shared and interrupts anyone
   * watching, so it confirms first and names what it is about to do -- and the
   * server records who did it.
   *
   * Sequential rather than parallel: each removal makes Dispatcharr rebuild
   * the guide, and firing a dozen at once has had it return partial lineups.
   */
  async function deleteSelected() {
    const targets = [...selectedIds]
      .map((id) => channelById.get(id))
      .filter((c): c is LiveChannel => !!c);
    if (targets.length === 0) return;

    const names = targets.map((c) => c.name).join(", ");
    if (
      !window.confirm(
        `Remove ${targets.length === 1 ? "this channel" : `these ${targets.length} channels`} ` +
          `from Live TV for everyone?\n\n${names}\n\n` +
          "The stream stays in the catalogue and can be added back. " +
          "To remove it only for yourself, use Hide instead."
      )
    ) {
      return;
    }

    setDeleting(true);
    setDeleteNote(null);
    const failed: string[] = [];
    try {
      for (const channel of targets) {
        const res = await fetch("/api/live/streams/demote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelName: channel.name }),
        });
        if (!res.ok) failed.push(channel.name);
      }
      if (failed.length > 0) {
        setDeleteNote(`Couldn't remove: ${failed.join(", ")}`);
      } else {
        setDeleteNote(
          `Removed ${targets.length} channel${targets.length === 1 ? "" : "s"}. ` +
            "Jellyfin caches its channel list, so it may take a few minutes to disappear."
        );
        exitSelectMode();
        router.refresh();
      }
    } finally {
      setDeleting(false);
    }
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

  if (!envSet || !reachable) {
    return (
      <p className="text-sm text-white/50">
        {!envSet
          ? "Live TV isn’t configured: JELLYFIN_URL or JELLYFIN_API_KEY is unset on the server."
          : "Jellyfin isn’t responding, so the lineup can’t be read. The catalogue below still works."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(PAGE_SIZE);
          }}
          placeholder="Search channels…"
          aria-label="Search channels"
          className="min-w-0 flex-1 text-base sm:text-sm"
        />
        <span className="text-sm text-white/40">
          {query ? `${filtered.length} of ${sorted.length}` : `${sorted.length} channel${sorted.length === 1 ? "" : "s"}`}
        </span>
        {!selectMode ? (
          <Button variant="secondary" onClick={() => setSelectMode(true)}>
            Select
          </Button>
        ) : (
          <Button variant="secondary" onClick={exitSelectMode}>
            Cancel
          </Button>
        )}
      </div>

      {selectMode && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/15 bg-black/30 px-4 py-3">
          <span className="text-sm text-white/70">{selectedIds.size} selected</span>
          <Button
            variant="primary"
            onClick={hideSelected}
            disabled={selectedIds.size === 0 || hiding || deleting}
            className="ml-auto"
            title="Hide from your own lineup -- nobody else is affected"
          >
            {hiding ? "Hiding…" : "Hide selected"}
          </Button>
          {/* Outlined rather than filled, and second: hiding is the one most
              people want, and this one changes the lineup for everybody. */}
          <Button
            variant="danger"
            onClick={deleteSelected}
            disabled={selectedIds.size === 0 || hiding || deleting}
            title="Remove from Live TV for everyone -- the stream stays in the catalogue"
          >
            {deleting ? "Deleting…" : "Delete selected"}
          </Button>
        </div>
      )}

      {deleteNote && <p className="text-sm text-white/60">{deleteNote}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((c) => (
          <ChannelCard
            key={c.id}
            channel={c}
            inList={false}
            selectMode={selectMode}
            selected={selectedIds.has(c.id)}
            onToggleSelect={() => toggleSelect(c.id)}
            info={infoByChannel[c.name]}
            status={statusByChannel[c.name]}
            logoFallback={logoFallbacks[c.name]}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="py-6 text-center text-sm text-white/40">
          {query ? <>No channels match “{query}”.</> : "The lineup is empty."}
        </p>
      )}

      {shown < filtered.length && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => setShown((n) => n + PAGE_SIZE)}>
            Show {Math.min(PAGE_SIZE, filtered.length - shown)} more
          </Button>
        </div>
      )}

      <div className="border-t border-white/10 pt-4">
        <h3 className="mb-2 text-sm font-semibold text-white/80">
          Hidden channels <span className="font-normal text-white/40">{hidden.length}</span>
        </h3>
        {hidden.length === 0 ? (
          <p className="text-sm text-white/40">Nothing hidden. Select channels above and choose Hide selected.</p>
        ) : (
          <ul className="space-y-2">
            {hidden.map((h) => (
              <li key={h.channelId} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-white/70">{h.name}</span>
                <Button size="sm" onClick={() => unhide(h.channelId)} disabled={unhiding === h.channelId}>
                  {unhiding === h.channelId ? "…" : "Unhide"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
