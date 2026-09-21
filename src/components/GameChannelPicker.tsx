"use client";

import { useState } from "react";
import type { LiveChannel } from "@/lib/liveTv";
import { LivePlayer } from "@/components/LivePlayer";

type Props = {
  /** The best single match -- EPG-confirmed or a name-based guess, or null. */
  channel: LiveChannel | null;
  /** Whether `channel` is a real fact (Dispatcharr's EPG names both teams in what's airing right now) rather than a guess. */
  channelConfirmed: boolean;
  /** Networks that plausibly carry this game's league, when there's no confident match. */
  candidates: LiveChannel[];
  /** Channel name -> provider name ("strong8k", "trex"), best effort. */
  providerByChannel: Record<string, string>;
};

/**
 * Plays a game, with a channel switcher rather than a single fixed source.
 *
 * `channel` comes first when present, in one of two ways that get told apart
 * in the UI (`channelConfirmed`): a real fact from Dispatcharr's EPG (the
 * programme airing right now on that channel names both teams), or -- when
 * there's no EPG data to ask -- the same name-based guess this always made
 * (a channel promoted under one of the two teams' own names). `candidates`
 * are a looser guess still (a network that carries this game's league,
 * nothing more specific), offered because a guess beats nothing when there
 * is no better match, not because any one of them is known to be showing
 * this particular game.
 *
 * Switching channels changes only which id LivePlayer is handed. Its own tune
 * effect is keyed on channelId, so it already tears down the old HLS session
 * and Jellyfin tune and starts a fresh one on a change -- nothing here has to
 * reimplement that.
 */
export function GameChannelPicker({ channel, channelConfirmed, candidates, providerByChannel }: Props) {
  const options = channel ? [channel, ...candidates] : candidates;
  const [selectedId, setSelectedId] = useState<string | null>(options[0]?.id ?? null);
  const selected = options.find((c) => c.id === selectedId) ?? options[0] ?? null;

  if (!selected) {
    return (
      <div className="rounded-lg border border-white/10 bg-netflix-dark/60 px-4 py-10 text-center">
        <p className="text-base font-semibold text-white/80">No channel available</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/50">
          Nothing in the current lineup looks like it&rsquo;s carrying this game. Check back closer
          to kickoff, or browse the full channel list from Live TV.
        </p>
      </div>
    );
  }

  return (
    <div>
      <LivePlayer
        channelId={selected.id}
        channelName={selected.name}
        nowPlaying={selected.now?.name ?? null}
      />

      {options.length > 1 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-white/70">
            {channel ? "Also on" : "Might be on"}
          </h2>
          <ul className="space-y-1.5">
            {options.map((c, i) => {
              const isSelected = c.id === selected.id;
              // Only the single best match earns a badge, and only when
              // it's actually one of the options -- the badge is a claim
              // about the match, not about being first in the list.
              const isBestMatch = channel != null && i === 0;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    aria-pressed={isSelected}
                    className={`flex w-full items-center gap-3 rounded px-3 py-2 text-left transition-colors ${
                      isSelected
                        ? "bg-netflix-red/15 ring-1 ring-netflix-red/50"
                        : "bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    {c.number && (
                      <span className="shrink-0 tabular-nums text-xs text-white/40">{c.number}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-white/90">
                      {c.name}
                      {providerByChannel[c.name] && (
                        <span className="ml-2 text-xs text-white/35">{providerByChannel[c.name]}</span>
                      )}
                    </span>
                    {isBestMatch && channelConfirmed && (
                      <span
                        className="shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400"
                        title="Dispatcharr's own schedule names both teams in what's airing right now"
                      >
                        Confirmed
                      </span>
                    )}
                    {isBestMatch && !channelConfirmed && (
                      <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/60">
                        Best match
                      </span>
                    )}
                    {isSelected && (
                      <span className="shrink-0 rounded bg-netflix-red px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                        Playing
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
