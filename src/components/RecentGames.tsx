"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/ui";
import { ROW_H2_CLASS } from "@/lib/browseLayout";
import type { SportsGame } from "@/lib/sportarr";
import { SportsGameRow } from "@/components/SportsGameRow";

/** How often the list is re-read while something is downloading. */
const DOWNLOAD_POLL_MS = 5_000;

async function readGames(): Promise<{ configured: boolean; games: SportsGame[] }> {
  const res = await fetch("/api/sports/games");
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/**
 * Games that finished in the last few days, each one a click from being
 * downloaded as a recording -- Sportarr's list, grouped by the viewer's own
 * calendar day. On the Recordings tab, under what is already downloading or
 * ready (it used to sit on the Sports tab, below the live and upcoming games).
 *
 * `exclude`: games already listed above it on the page, left out here so a
 * recording isn't shown twice. `onChange`: a row's own answer (a download
 * started, a check finished), so the page can refresh what it lists above.
 */
export function RecentGames({
  exclude,
  onChange,
}: {
  exclude?: ReadonlySet<number>;
  onChange?: (game: SportsGame) => void;
}) {
  const [games, setGames] = useState<SportsGame[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [gamesError, setGamesError] = useState(false);

  // State is only ever set from the fetch's callbacks, never from the effect
  // body itself (react-hooks/set-state-in-effect).
  const loadGames = useCallback(
    (isLive: () => boolean) =>
      readGames()
        .then((data) => {
          if (!isLive()) return;
          setConfigured(data.configured);
          setGames(data.games);
          setGamesError(false);
        })
        .catch(() => {
          if (!isLive()) return;
          setGamesError(true);
          setGames((g) => g ?? []);
        }),
    []
  );

  useEffect(() => {
    let live = true;
    void loadGames(() => live);
    return () => {
      live = false;
    };
  }, [loadGames]);

  // Polls only while a download is in flight: progress is the one thing here
  // that changes by the second.
  const downloading = games?.some((g) => g.status === "downloading") ?? false;
  useEffect(() => {
    if (!downloading) return;
    let live = true;
    const t = setInterval(() => void loadGames(() => live), DOWNLOAD_POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [downloading, loadGames]);

  const shown = useMemo(() => (games ?? []).filter((g) => !exclude?.has(g.id)), [games, exclude]);

  // Grouped by the viewer's own calendar day: a 10:30 PM Pacific game is
  // "yesterday" to them, whatever UTC says.
  const byDay = useMemo(() => {
    const groups: { key: string; label: string; games: SportsGame[] }[] = [];
    for (const g of shown) {
      const d = new Date(g.startUtc);
      const key = d.toDateString();
      let group = groups.find((x) => x.key === key);
      if (!group) {
        group = { key, label: d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }), games: [] };
        groups.push(group);
      }
      group.games.push(g);
    }
    return groups;
  }, [shown]);

  const replace = (next: SportsGame) => {
    setGames((list) => (list ?? []).map((g) => (g.id === next.id ? next : g)));
    onChange?.(next);
  };

  return (
    <section className="mb-8">
      <h2 className={ROW_H2_CLASS}>Recent games</h2>
      {!configured ? (
        <Panel className="text-center">
          <p className="text-base font-semibold text-white/80">Recordings aren’t configured</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/50">
            <code className="text-white/70">SPORTARR_URL</code> or <code className="text-white/70">SPORTARR_API_KEY</code> is
            unset on the server.
          </p>
        </Panel>
      ) : games === null ? (
        <p className="text-sm text-white/40">Loading…</p>
      ) : gamesError && games.length === 0 ? (
        <p className="text-sm text-white/40">Sportarr isn’t responding.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-white/40">
          {games.length === 0 ? "No games have finished in the last few days." : "Every recent game is listed above."}
        </p>
      ) : (
        byDay.map((day) => (
          <div key={day.key} className="mb-5">
            <h3 className="mb-2 text-sm font-semibold text-white/60">{day.label}</h3>
            <ul className="space-y-1">
              {day.games.map((g) => (
                <SportsGameRow key={g.id} game={g} onChange={replace} />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
