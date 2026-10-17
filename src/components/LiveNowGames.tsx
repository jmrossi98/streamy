"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { ROW_H2_CLASS } from "@/lib/browseLayout";
import { pickLiveNow, type NowFixture } from "@/lib/liveNowRules";
import { liveTabHref } from "@/lib/liveTabs";
import { findCandidateChannels, networksOnOtherGames, resolveChannelForFixture } from "@/lib/liveTimeline";

type Fixture = NowFixture & {
  awayTeam: string | null;
  homeTeam: string | null;
  /** Channel names Dispatcharr's real EPG confirms are airing this fixture right now. */
  epgConfirmedChannelNames: string[];
};

type ScheduleChannel = { id: string; name: string };

/**
 * The top of the Now tab: the games in progress this minute, each one click
 * from its game page. Same source as the Sports tab (/api/live/schedule), a
 * different question -- "what can I watch right now", not "what is on
 * today". When nothing is in progress it shows the next few kickoffs under
 * "Up next" instead, so the tab never opens on an empty heading.
 *
 * Renders nothing at all when the schedule is unavailable or empty: a third
 * party being down is not worth a notice above the channel rows.
 */
export function LiveNowGames({ channels }: { channels: ScheduleChannel[] }) {
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/live/schedule")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { fixtures: Fixture[] }) => {
        if (!cancelled) setFixtures(data.fixtures);
      })
      .catch(() => {
        if (!cancelled) setFixtures([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Games the lineup already carries sort first -- the same check the Sports
  // tab makes, used here to order rather than to filter (see pickLiveNow).
  const pick = useMemo(() => {
    if (!fixtures) return null;
    const watchableIds = new Set(
      fixtures
        .filter(
          (f) =>
            resolveChannelForFixture(f, channels, f.epgConfirmedChannelNames) != null ||
            findCandidateChannels({ ...f, networksOnOtherGames: networksOnOtherGames(f, fixtures) }, channels, 1).length > 0
        )
        .map((f) => f.id)
    );
    return pickLiveNow(fixtures, { watchableIds });
  }, [fixtures, channels]);

  if (!pick || pick.fixtures.length === 0) return null;
  const live = pick.kind === "live";

  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={ROW_H2_CLASS}>
          {live ? "Live now" : "Up next"}{" "}
          <span className="text-sm font-normal text-white/40">{pick.fixtures.length}</span>
        </h2>
        <Link href={liveTabHref("sports")} className="shrink-0 text-xs text-white/50 hover:text-white">
          Full schedule
        </Link>
      </div>
      <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
        {pick.fixtures.map((f) => (
          <article
            key={f.id}
            className="flex w-72 shrink-0 snap-start flex-col gap-2 rounded-lg border border-white/10 bg-netflix-dark/80 p-3"
          >
            <div className="flex items-center gap-2">
              <span
                className={`text-[10px] font-bold uppercase tracking-wide ${live ? "text-netflix-red" : "text-white/40"}`}
              >
                {f.league}
              </span>
              <span className={`ml-auto truncate text-xs ${live ? "font-semibold text-netflix-red" : "text-white/50"}`}>
                {live && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-netflix-red align-middle" />}
                {f.detail}
              </span>
            </div>
            <p className="truncate text-sm font-semibold text-white" title={f.name}>
              {f.name}
            </p>
            <ButtonLink
              // ?auto=1: the game page may add a verified stream for it (GameStreamFinder).
              href={`/live/game/${encodeURIComponent(f.id)}${live ? "?auto=1" : ""}`}
              variant={live ? "primary" : "secondary"}
              size="sm"
              className="self-start"
            >
              {live ? "Watch" : "Open"}
            </ButtonLink>
          </article>
        ))}
      </div>
    </section>
  );
}
