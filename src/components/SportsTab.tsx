"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { leagueTag } from "@/lib/leagueTags";
import { Badge, ButtonLink } from "@/components/ui";
import { ROW_H2_CLASS } from "@/lib/browseLayout";
import { liveTabHref } from "@/lib/liveTabs";
import type { Fixture } from "@/lib/sportsSchedule";

type ScheduleFixture = Fixture & { epgConfirmedChannelNames: string[] };

/**
 * The Sports tab: what is on now and what is on later today, from ESPN
 * (/api/live/schedule), which has the clock, the period and the score.
 *
 * Finished games come from Sportarr, the only thing that can fetch a
 * recording of one, and live on the Recordings tab as "Recent games", under
 * what is already downloaded (RecentGames). ESPN's finished games are left
 * out here rather than listed twice.
 */
export function SportsTab() {
  const [fixtures, setFixtures] = useState<ScheduleFixture[] | null>(null);

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

  const live = useMemo(() => (fixtures ?? []).filter((f) => f.state === "in"), [fixtures]);
  const upcoming = useMemo(
    () =>
      (fixtures ?? [])
        .filter((f) => f.state === "pre")
        .sort((a, b) => (a.startUtc ? Date.parse(a.startUtc) : Infinity) - (b.startUtc ? Date.parse(b.startUtc) : Infinity)),
    [fixtures]
  );

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

      <p className="text-sm text-white/40">
        Finished games, ready to download as recordings, are on the{" "}
        <Link href={liveTabHref("recordings")} className="text-white/70 underline-offset-2 hover:underline">
          Recordings
        </Link>{" "}
        tab.
      </p>
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
