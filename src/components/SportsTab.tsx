"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { leagueTag } from "@/lib/leagueTags";
import { Badge, ButtonLink, Panel } from "@/components/ui";
import { ROW_H2_CLASS } from "@/lib/browseLayout";
import type { SportsGame } from "@/lib/sportarr";
import type { Fixture } from "@/lib/sportsSchedule";
import { SportsGameRow } from "@/components/SportsGameRow";

type ScheduleFixture = Fixture & { epgConfirmedChannelNames: string[] };

/** How often the finished-games list is re-read while something is downloading. */
const DOWNLOAD_POLL_MS = 5_000;

async function readGames(): Promise<{ configured: boolean; games: SportsGame[] }> {
  const res = await fetch("/api/sports/games");
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/**
 * The Sports tab: what is on now, what is on later today, and what has
 * finished and can be downloaded as a recording.
 *
 * Two sources on purpose. ESPN (/api/live/schedule) has the clock, the
 * period and the score for games in progress, which Sportarr does not; so
 * "Live now" and "Upcoming today" are ESPN's. Sportarr has the finished games
 * and is the only thing that can fetch a recording of one; so "Recent games"
 * is Sportarr's, and ESPN's finished games are left out rather than listed
 * twice.
 */
export function SportsTab() {
  const [fixtures, setFixtures] = useState<ScheduleFixture[] | null>(null);
  const [games, setGames] = useState<SportsGame[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [gamesError, setGamesError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/live/schedule")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { fixtures: ScheduleFixture[] }) => {
        if (!cancelled) setFixtures(data.fixtures);
      })
      .catch(() => {
        if (!cancelled) setFixtures([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Polls only while a download is in flight: progress is the one thing on
  // this tab that changes by the second.
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

  const live = useMemo(() => (fixtures ?? []).filter((f) => f.state === "in"), [fixtures]);
  const upcoming = useMemo(
    () =>
      (fixtures ?? [])
        .filter((f) => f.state === "pre")
        .sort((a, b) => (a.startUtc ? Date.parse(a.startUtc) : Infinity) - (b.startUtc ? Date.parse(b.startUtc) : Infinity)),
    [fixtures]
  );

  // Grouped by the viewer's own calendar day: a 10:30 PM Pacific game is
  // "yesterday" to them, whatever UTC says.
  const byDay = useMemo(() => {
    const groups: { key: string; label: string; games: SportsGame[] }[] = [];
    for (const g of games ?? []) {
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
  }, [games]);

  const replace = (next: SportsGame) => setGames((list) => (list ?? []).map((g) => (g.id === next.id ? next : g)));

  return (
    <>
      <section className="mb-8">
        <h2 className={ROW_H2_CLASS}>
          Live now {live.length > 0 && <span className="text-sm font-normal text-white/40">{live.length}</span>}
        </h2>
        {fixtures === null ? (
          <p className="text-sm text-white/40">Loading…</p>
        ) : live.length === 0 ? (
          <p className="text-sm text-white/40">Nothing in progress right now.</p>
        ) : (
          <ul className="space-y-1">
            {live.map((f) => (
              <FixtureRow key={f.id} fixture={f} live />
            ))}
          </ul>
        )}
      </section>

      {upcoming.length > 0 && (
        <section className="mb-8">
          <h2 className={ROW_H2_CLASS}>
            Upcoming today <span className="text-sm font-normal text-white/40">{upcoming.length}</span>
          </h2>
          <ul className="space-y-1">
            {upcoming.map((f) => (
              <FixtureRow key={f.id} fixture={f} />
            ))}
          </ul>
        </section>
      )}

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
        ) : games.length === 0 ? (
          <p className="text-sm text-white/40">No games have finished in the last few days.</p>
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
    </>
  );
}

/** A game ESPN knows about: in progress (Watch) or still to come (Open). */
function FixtureRow({ fixture: f, live = false }: { fixture: ScheduleFixture; live?: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded bg-white/5 px-3 py-2">
      <Badge tone={live ? "danger" : "neutral"} title={f.league} className="min-w-12 shrink-0 justify-center uppercase tracking-wide">
        {leagueTag(f.league)}
      </Badge>
      <p className="order-last w-full min-w-0 flex-1 truncate text-sm text-white/90 sm:order-none sm:w-auto" title={f.name}>
        {f.name}
      </p>
      <span className={`shrink-0 text-xs ${live ? "font-semibold text-netflix-red" : "text-white/50"}`}>
        {live && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-netflix-red align-middle" />}
        {f.detail}
      </span>
      <ButtonLink href={`/live/game/${encodeURIComponent(f.id)}`} variant={live ? "primary" : "secondary"} size="sm" className="ml-auto shrink-0">
        {live ? "Watch" : "Open"}
      </ButtonLink>
    </li>
  );
}
