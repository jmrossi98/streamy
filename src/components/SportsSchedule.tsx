"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { findCandidateChannels, resolveChannelForFixture } from "@/lib/liveTimeline";

type Fixture = {
  id: string;
  league: string;
  startUtc: string | null;
  detail: string;
  state: "pre" | "in" | "post";
  name: string;
  awayTeam: string | null;
  homeTeam: string | null;
  /** Channel names Dispatcharr's real EPG confirms are airing this fixture right now. */
  epgConfirmedChannelNames: string[];
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

  // Whether there's anything to actually watch this for, not just whether
  // ESPN listed a game. A row with no channel and no plausible candidate is a
  // dead end -- it used to render as plain, unclickable text, which read as
  // "the app doesn't know" rather than "there's genuinely nothing to watch
  // this on right now". Filtering it out says the second thing directly.
  const watchable = useMemo(() => {
    if (!fixtures) return null;
    return fixtures
      .map((f) => ({
        fixture: f,
        hasChannel:
          resolveChannelForFixture(f, channels, f.epgConfirmedChannelNames) != null ||
          findCandidateChannels(f, channels, 1).length > 0,
      }))
      .filter((x) => x.hasChannel)
      .map((x) => x.fixture);
  }, [fixtures, channels]);

  if (error) return null; // A third party being down is not worth a page-level error.
  if (watchable !== null && watchable.length === 0) return null;

  return (
    <section className="mt-10 mb-10">
      {/* Not "Today": the slate reaches past midnight UTC and regularly
          shows tomorrow's fixtures alongside tonight's, so the heading was
          claiming a narrower window than the list actually covers. */}
      <h2 className="streamy-page-title-x mb-1 font-display text-2xl font-bold text-white">
        Game Schedule
      </h2>
      <p className="streamy-page-title-x mb-4 text-sm text-white/50">
        What&rsquo;s being played and where to watch it - only games with a
        channel to try.
      </p>

      {watchable === null ? (
        <p className="streamy-page-title-x text-sm text-white/40">Loading…</p>
      ) : (
        <ul className="streamy-page-title-x space-y-1">
          {watchable.map((f) => (
            <li key={f.id}>
              <Link
                href={`/live/game/${encodeURIComponent(f.id)}`}
                className="flex items-center gap-3 rounded bg-white/5 px-3 py-2 transition-colors hover:bg-white/10"
              >
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
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
