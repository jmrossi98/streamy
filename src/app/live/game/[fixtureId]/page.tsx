import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { unstable_noStore } from "next/cache";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { StoredChoice } from "@/lib/gameChannelChoice";
import { getLiveChannels, isJellyfinReachable } from "@/lib/liveTv";
import { getTodaysFixtures } from "@/lib/sportsSchedule";
import { getChannelInfo, getMappedChannelPrograms, type ChannelInfo } from "@/lib/dispatcharr";
import { findCandidateChannels, findEpgConfirmedChannelNames, resolveChannelForFixture } from "@/lib/liveTimeline";
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

  // Which channel this viewer picked for this game last time, if any. Best
  // effort on purpose: a database hiccup should cost the remembered pick and
  // fall back to the best match, not take the game page down.
  let storedChoice: StoredChoice | null = null;
  try {
    const userId = await getValidSessionUserId(session);
    if (userId) {
      const row = await prisma.gameChannelChoice.findUnique({
        where: { userId_fixtureId: { userId, fixtureId } },
        select: { channelId: true, name: true },
      });
      storedChoice = row ?? null;
    }
  } catch (err) {
    console.error("[live/game] stored channel lookup failed:", err);
  }

  // Best effort, same reasoning as the schedule route: a Dispatcharr hiccup
  // must not take the page down, only cost it the (already best-effort)
  // upgrade from a name-based guess to a real confirmed channel.
  let epgConfirmedNames: string[] = [];
  try {
    const programs = await getMappedChannelPrograms();
    if (programs) epgConfirmedNames = findEpgConfirmedChannelNames(fixture, programs);
  } catch (err) {
    console.error("[live/game] EPG match failed:", err);
  }

  // Same best-effort reasoning as the EPG lookup above. Two things come out
  // of this: which provider each option is on (informational), and which
  // options Dispatcharr has already marked dead -- the second of which
  // actually reorders the list below.
  let infoByChannel: Record<string, ChannelInfo> = {};
  try {
    const info = await getChannelInfo();
    if (info) infoByChannel = Object.fromEntries(info);
  } catch (err) {
    console.error("[live/game] getChannelInfo failed:", err);
  }
  const isStale = (name: string) => infoByChannel[name]?.stale === true;

  const resolved = resolveChannelForFixture(fixture, channels, epgConfirmedNames);
  const channelConfirmed = resolved != null && epgConfirmedNames.includes(resolved.name);
  /*
    Only a real EPG fact suppresses the rest -- a confirmed channel needs no
    guesses alongside it. `resolved` being non-null on its own is not that:
    without EPG data, resolveChannelForFixture falls back to the same kind of
    name-based guess candidates are (a channel promoted under one team's own
    name), and that guess being wrong is exactly when a viewer wants another
    option to try. This used to hide every candidate -- NHL Network, ESPN,
    any network airing the league -- the moment a fixture-named channel like
    "NHL SAN JOSE SHARKS" existed at all, reported live for a Sharks game
    that had nothing else to switch to.

    Filtered by id rather than left to dedupe itself: a fixture-named channel
    like that one also matches its own team's market (see findCandidateChannels'
    city matching), so without this it would appear twice -- once as the
    primary pick, once again inside the candidate list.
  */
  const networkOrMarketCandidates = channelConfirmed
    ? []
    : findCandidateChannels(fixture, channels, 8).filter((c) => c.id !== resolved?.id);

  /*
    An unconfirmed `resolved` is, by construction, exactly the category
    findChannelForFixture matches: a channel promoted under one team's own
    name -- the one-off fixture type looksLikeEventFeed already warns about
    elsewhere (StreamBrowser), and confirmed live 2026-09-20 to show a
    permanent "the stream is starting" placeholder loop on *every* one
    tried, never the actual game. Not trustworthy enough to keep the
    privileged default slot over an actual network or local-affiliate
    candidate when one exists -- demoted to the end of the candidate list
    instead of dropped outright, since it might still work and there is
    nothing better to offer when it's genuinely the only option.
  */
  const demoteUnconfirmedFixtureGuess =
    resolved != null && !channelConfirmed && networkOrMarketCandidates.length > 0;
  const primary = demoteUnconfirmedFixtureGuess ? null : resolved;
  const restCandidates = demoteUnconfirmedFixtureGuess
    ? [...networkOrMarketCandidates, resolved!]
    : networkOrMarketCandidates;

  /*
    Dead streams sink, they don't disappear.

    Dispatcharr already knows which streams it has given up on (`is_stale`,
    the same flag the stream browser warns on) and nothing here consulted
    it, so a channel the provider itself considers dead could be handed to
    a viewer as the default pick -- who then finds out the only way anyone
    was finding out: a minute of spinner followed by a failure.

    Sorted rather than filtered, and stably so, because the flag is a
    provider's opinion and can lag a stream that has come back. A dead
    option is still better than no option when it is the only one left, so
    it keeps its place in the list, just not at the front of it. A stale
    primary loses the default slot the same way an unconfirmed fixture
    guess does above -- unless there is nothing else, in which case it
    stays, since demoting it to an empty list helps no one.

    An EPG-confirmed channel is exempt: that is a fact about what is airing
    right now, which beats a staleness flag that may simply not have caught
    up yet.
  */
  const primaryIsDead = primary != null && !channelConfirmed && isStale(primary.name);
  const liveCandidates = restCandidates.filter((c) => !isStale(c.name));
  const deadCandidates = restCandidates.filter((c) => isStale(c.name));
  const demoteDeadPrimary = primaryIsDead && liveCandidates.length > 0;

  const channel = demoteDeadPrimary ? null : primary;
  const candidates = demoteDeadPrimary
    ? [...liveCandidates, primary!, ...deadCandidates]
    : [...liveCandidates, ...deadCandidates];

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

        <GameChannelPicker
          channel={channel}
          channelConfirmed={channelConfirmed}
          candidates={candidates}
          infoByChannel={infoByChannel}
          fixtureId={fixtureId}
          storedChoice={storedChoice}
        />
      </div>
    </div>
  );
}
