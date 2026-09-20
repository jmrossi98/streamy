import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { unstable_noStore } from "next/cache";
import { getSession } from "@/lib/auth";
import { getLiveChannels, isJellyfinReachable } from "@/lib/liveTv";
import { getTodaysFixtures } from "@/lib/sportsSchedule";
import { findCandidateChannels, findChannelForFixture } from "@/lib/liveTimeline";
import { GameChannelPicker } from "@/components/GameChannelPicker";
import { BROWSE_PAGE_CLASS } from "@/lib/browseLayout";

/**
 * One game's page: which channel is showing it, and what else might be.
 *
 * The schedule used to answer this by linking straight to a single channel
 * (the confident match) and leaving everything else as small text underneath
 * -- fine when there was one answer, awkward the moment there is more than
 * one plausible channel and no way to try another without leaving the game
 * entirely. This page is the fix: one URL per game, a player that swaps
 * source in place when a different channel is picked (LivePlayer already
 * tears down and re-tunes cleanly on a changed channelId -- this just gives
 * it a reason to).
 */
export const dynamic = "force-dynamic";

export default async function GamePage({
  params,
}: {
  params: Promise<{ fixtureId: string }>;
}) {
  unstable_noStore();
  const { fixtureId: encodedFixtureId } = await params;
  const fixtureId = decodeURIComponent(encodedFixtureId);

  const session = await getSession();
  if (!session) redirect(`/login?callbackUrl=/live/game/${encodedFixtureId}`);
  if (!(await isJellyfinReachable())) notFound();

  // Fetched fresh rather than looked up from a cache keyed by id: ESPN gives
  // no single-event endpoint in the shape getTodaysFixtures already parses
  // and tests, and today's slate is small enough that re-fetching it is
  // cheap -- the schedule panel pays the same cost on every load.
  const [fixtures, channels] = await Promise.all([getTodaysFixtures(), getLiveChannels()]);
  const fixture = fixtures.find((f) => f.id === fixtureId);
  if (!fixture) notFound();

  const channel = findChannelForFixture(fixture, channels);
  // Never both: a fixture with a confident match doesn't also get itself
  // listed among the guesses, and candidates are already excess-of-one.
  const candidates = channel ? [] : findCandidateChannels(fixture, channels, 8);

  return (
    <div className={BROWSE_PAGE_CLASS}>
      <div className="mx-auto w-full max-w-5xl px-4 md:px-6">
        <Link href="/live" className="text-sm text-white/50 transition-colors hover:text-white">
          ← Live TV
        </Link>

        <div className="mb-4 mt-3">
          <span
            className={`text-xs font-bold uppercase tracking-wide ${
              fixture.state === "in" ? "text-netflix-red" : "text-white/40"
            }`}
          >
            {fixture.league}
          </span>
          <h1 className="font-display text-2xl font-bold text-white sm:text-3xl">
            {fixture.name}
          </h1>
          <p
            className={`text-sm ${fixture.state === "in" ? "font-semibold text-netflix-red" : "text-white/50"}`}
          >
            {fixture.state === "in" && (
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-netflix-red align-middle" />
            )}
            {fixture.detail}
          </p>
        </div>

        <GameChannelPicker channel={channel} candidates={candidates} />
      </div>
    </div>
  );
}
