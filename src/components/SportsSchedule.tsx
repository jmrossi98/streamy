"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { findCandidateChannels, findChannelForFixture } from "@/lib/liveTimeline";

type Fixture = {
  id: string;
  league: string;
  startUtc: string | null;
  detail: string;
  state: "pre" | "in" | "post";
  name: string;
  awayTeam: string | null;
  homeTeam: string | null;
};

type ScheduleChannel = { id: string; name: string };

/**
 * Today's games, from a source that actually knows -- which the provider
 * catalogue does not.
 *
 * A promoted fixture channel is dead until its game starts, and from inside
 * Streamy that looks identical to a broken channel. This is the missing half:
 * it doesn't say whether anything here is carried on a channel in the lineup,
 * only what is being played and when, so "is Buffalo on tonight" has an answer
 * that isn't "try tuning it and see".
 */
export function SportsSchedule({ channels }: { channels: ScheduleChannel[] }) {
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/live/schedule")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { fixtures: Fixture[] }) => {
        if (!cancelled) setFixtures(data.fixtures);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return null; // A third party being down is not worth a page-level error.
  if (fixtures !== null && fixtures.length === 0) return null;

  return (
    <section className="mt-10 mb-10">
      <h2 className="streamy-page-title-x mb-1 font-display text-2xl font-bold text-white">
        Today
      </h2>
      <p className="streamy-page-title-x mb-4 text-sm text-white/50">
        What&rsquo;s being played, not what&rsquo;s in the lineup — a fixture
        feed is only live while its game is.
      </p>

      {fixtures === null ? (
        <p className="streamy-page-title-x text-sm text-white/40">Loading…</p>
      ) : (
        <ul className="streamy-page-title-x space-y-1">
          {fixtures.map((f) => {
            // No EPG here -- nothing says which channel is airing which game
            // -- so this is a name-based guess against your own lineup, not a
            // fact. Conservative on purpose: no link beats a wrong one, so an
            // unmatched fixture stays plain text exactly as it was before.
            const channel = findChannelForFixture(f, channels);
            // Only worth computing when there's no direct link -- a fixture
            // that already resolved to its own channel doesn't need guesses.
            const candidates = channel ? [] : findCandidateChannels(f, channels);
            const row = (
            <li
              key={f.id}
              className={`rounded bg-white/5 px-3 py-2 ${
                channel ? "transition-colors hover:bg-white/10" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`w-14 shrink-0 text-center text-[10px] font-bold uppercase tracking-wide ${
                    f.state === "in" ? "text-netflix-red" : "text-white/40"
                  }`}
                >
                  {f.league}
                </span>
                <p className="min-w-0 flex-1 truncate text-sm text-white/90">{f.name}</p>
                <span
                  className={`shrink-0 text-xs ${
                    f.state === "in" ? "font-semibold text-netflix-red" : "text-white/50"
                  }`}
                >
                  {f.state === "in" && (
                    <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-netflix-red align-middle" />
                  )}
                  {f.detail}
                </span>
              </div>
              {/*
                No single channel confirmed -- not nothing, either. A list of
                networks that plausibly carry this league, so "is Buffalo on
                tonight" has more of an answer than silence when the fixture
                channel itself isn't promoted (or hasn't gone live yet).
              */}
              {candidates.length > 0 && (
                <p className="mt-1 pl-[68px] text-xs text-white/40">
                  Might be on:{" "}
                  {candidates.map((c, i) => (
                    <span key={c.id}>
                      {i > 0 && ", "}
                      <Link
                        href={`/live/${encodeURIComponent(c.id)}`}
                        className="text-white/60 underline decoration-white/20 underline-offset-2 hover:text-white"
                      >
                        {c.name}
                      </Link>
                    </span>
                  ))}
                </p>
              )}
            </li>
            );
            // A link over the same content rather than a whole separate
            // presentation, so "this fixture goes to a channel" changes
            // nothing about the row except that it is now clickable.
            return channel ? (
              <Link key={f.id} href={`/live/${encodeURIComponent(channel.id)}`}>
                {row}
              </Link>
            ) : (
              row
            );
          })}
        </ul>
      )}
    </section>
  );
}
