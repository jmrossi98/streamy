/**
 * Pre-game prep: before anyone opens a followed team's game, find the game's
 * own feed in the providers' catalogues, check it carries video, and add it to
 * the lineup -- the work the game page otherwise does while its viewer waits
 * (gamePrepRules.ts has the evening that prompted it and the rules). Run by
 * the game-prep cron every 10 minutes.
 *
 * Gentle with the provider lines, which viewers come first for: nothing is
 * checked or warmed on a provider anyone is watching, at most a few streams
 * are checked per game per run, and a stream found dead is left alone for a
 * while. Adding goes through promoteStream as an automatic add, so it is one
 * feed per game, recorded against the game and removed after it like any
 * feed a game page adds.
 */
import { prisma } from "./db";
import { fetchFixtureTeams, getTodaysFixtures, type Fixture } from "./sportsSchedule";
import { listGameStreamCandidates, type GameStreamCandidate } from "./gameStreamCandidates";
import { isStreamProbeConfigured, probeStream } from "./streamProbe";
import { applyResult, pickAutoAdd, type VerifyState } from "./streamVerifyRules";
import { listedOrRefresh, promoteStream } from "./promoteStream";
import { getLiveChannels } from "./liveTv";
import { isDispatcharrConfigured, listIptvAccounts, liveConnections } from "./dispatcharr";
import { cleanChannelName } from "./liveChannelRules";
import { channelKey } from "./liveChannelStateRules";
import {
  FOLLOW_WINDOW_MS,
  PREP_MAX_SCORE,
  fixturesToPrep,
  followedTeams,
  prepCandidates,
  providersInUse,
  DEAD_RECHECK_MS,
  type Visit,
} from "./gamePrepRules";

/**
 * Remembers that a signed-in viewer opened a game's page. Best effort and never
 * awaited by the page: a failure costs one data point for following, never the
 * page.
 */
export async function recordGameVisit(
  userId: string,
  fixture: Pick<Fixture, "id" | "league" | "homeTeam" | "awayTeam">
): Promise<void> {
  try {
    await prisma.gameVisit.upsert({
      where: { userId_fixtureId: { userId, fixtureId: fixture.id } },
      create: { userId, fixtureId: fixture.id, league: fixture.league, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam },
      update: { visitedAt: new Date() },
    });
  } catch (err) {
    console.error("[game-prep] couldn't record a visit:", err instanceof Error ? err.message : err);
  }
}

/** Picks made before visits were recorded, read as visits: their games are looked up once. */
const BACKFILL_PER_RUN = 10;

async function backfillVisitsFromPicks(since: Date): Promise<number> {
  const picks = await prisma.gameChannelChoice.findMany({
    where: { pickedAt: { gte: since } },
    select: { userId: true, fixtureId: true, pickedAt: true },
  });
  if (picks.length === 0) return 0;
  const visits = await prisma.gameVisit.findMany({
    where: { fixtureId: { in: [...new Set(picks.map((p) => p.fixtureId))] } },
    select: { userId: true, fixtureId: true },
  });
  const have = new Set(visits.map((v) => `${v.userId}\u0000${v.fixtureId}`));
  const missing = picks.filter((p) => !have.has(`${p.userId}\u0000${p.fixtureId}`)).slice(0, BACKFILL_PER_RUN);
  let added = 0;
  const teams = new Map<string, Awaited<ReturnType<typeof fetchFixtureTeams>>>();
  for (const p of missing) {
    if (!teams.has(p.fixtureId)) teams.set(p.fixtureId, await fetchFixtureTeams(p.fixtureId));
    const t = teams.get(p.fixtureId);
    if (!t) continue;
    await prisma.gameVisit
      .create({ data: { userId: p.userId, fixtureId: p.fixtureId, league: t.league, homeTeam: t.homeTeam, awayTeam: t.awayTeam, visitedAt: p.pickedAt } })
      .then(() => added++)
      .catch(() => {});
  }
  return added;
}

/** Streams found dead, by id, with when: not checked again for a while (DEAD_RECHECK_MS). */
const deadSince = new Map<number, number>();

export type GamePrepAction =
  | "ready" // a feed added for the game is in the lineup already
  | "joining" // added, and Jellyfin was asked to list it
  | "added" // prep added a feed this run
  | "nothing-plays-yet" // feeds named for the game, none carrying video yet
  | "no-feeds" // nothing in the catalogues names the game
  | "providers-busy" // the game's feeds are all on providers someone is watching
  | "failed"; // adding the one that played didn't work

export type GamePrepReport = {
  ranAt: string;
  /** Why nothing was attempted, when nothing was. */
  skipped: string | null;
  followed: string[];
  backfilled: number;
  games: { fixtureId: string; name: string; action: GamePrepAction; detail?: string }[];
  errors: { step: string; error: string }[];
};

let running: Promise<GamePrepReport> | null = null;

/** One prep pass. Never two at once: a second call while one runs gets that one's report. */
export function runGamePrep(now: Date = new Date()): Promise<GamePrepReport> {
  if (!running) {
    running = prepPass(now).finally(() => {
      running = null;
    });
  }
  return running;
}

async function prepPass(now: Date): Promise<GamePrepReport> {
  const report: GamePrepReport = { ranAt: now.toISOString(), skipped: null, followed: [], backfilled: 0, games: [], errors: [] };
  const fail = (step: string, err: unknown) =>
    report.errors.push({ step, error: err instanceof Error ? err.message : String(err) });

  for (const [id, at] of deadSince) if (now.getTime() - at > DEAD_RECHECK_MS) deadSince.delete(id);
  if (!isDispatcharrConfigured()) return { ...report, skipped: "Dispatcharr isn't configured" };
  if (!isStreamProbeConfigured()) return { ...report, skipped: "the stream probe isn't configured" };

  const since = new Date(now.getTime() - FOLLOW_WINDOW_MS);
  report.backfilled = await backfillVisitsFromPicks(since).catch((err) => {
    fail("backfill", err);
    return 0;
  });
  await prisma.gameVisit.deleteMany({ where: { visitedAt: { lt: since } } }).catch((err) => fail("sweep", err));
  const rows = await prisma.gameVisit.findMany({ where: { visitedAt: { gte: since } } }).catch((err) => {
    fail("visits", err);
    return [];
  });
  const visits: Visit[] = rows.map((r) => ({ ...r, visitedAt: r.visitedAt.getTime() }));
  const followed = followedTeams(visits, now.getTime());
  report.followed = [...followed].sort();
  if (followed.size === 0) return { ...report, skipped: "no followed teams yet" };

  const fixtures = await getTodaysFixtures().catch((err) => {
    fail("schedule", err);
    return [] as Fixture[];
  });
  const games = fixturesToPrep(fixtures, followed, now.getTime());
  if (games.length === 0) return { ...report, skipped: "no followed team's game is on or about to start" };

  const [lineup, added, linked, accounts, connections] = await Promise.all([
    getLiveChannels().catch((err) => {
      fail("lineup", err);
      return [];
    }),
    prisma.gameChannel.findMany({ where: { fixtureId: { in: games.map((g) => g.id) } } }).catch(() => []),
    prisma.gameChannelLink.findMany({ where: { fixtureId: { in: games.map((g) => g.id) } } }).catch(() => []),
    listIptvAccounts().catch(() => null),
    liveConnections().catch(() => null),
  ]);
  const listed = new Set(lineup.map((c) => channelKey(c.name)));
  const busy = providersInUse(accounts ?? [], connections);

  for (const game of games) {
    try {
      report.games.push({ fixtureId: game.id, name: game.name, ...(await prepGame(game, added, linked, listed, busy, now.getTime())) });
    } catch (err) {
      fail(`game ${game.id}`, err);
    }
  }
  const summary = report.games.map((g) => `${g.name}: ${g.action}${g.detail ? ` (${g.detail})` : ""}`).join("; ");
  if (summary) console.log(`[game-prep] ${summary}`);
  return report;
}

async function prepGame(
  game: Fixture,
  added: { fixtureId: string; name: string }[],
  linked: { fixtureId: string; name: string }[],
  listed: Set<string>,
  busy: Set<string>,
  now: number
): Promise<{ action: GamePrepAction; detail?: string }> {
  const forGame = [...added, ...linked].filter((r) => r.fixtureId === game.id);
  const inLineup = forGame.find((r) => listed.has(channelKey(cleanChannelName(r.name))));
  if (inLineup) return { action: "ready", detail: inLineup.name };
  if (forGame.length > 0) {
    // In Dispatcharr but not yet in Jellyfin's lineup (its refresh never ran,
    // or hasn't finished): ask again, at most every couple of minutes per name.
    const id = await listedOrRefresh(cleanChannelName(forGame[0].name));
    return { action: id ? "ready" : "joining", detail: forGame[0].name };
  }

  const ranked = await listGameStreamCandidates(game);
  const named = ranked.filter((c) => c.score != null && c.score <= PREP_MAX_SCORE);
  if (named.length === 0) return { action: "no-feeds" };
  const toCheck = prepCandidates(named, busy, deadSince, now);
  if (toCheck.length === 0) {
    const allBusy = named.every((c) => c.provider && busy.has(c.provider.toLowerCase()));
    return allBusy
      ? { action: "providers-busy", detail: [...busy].join(", ") }
      : { action: "nothing-plays-yet", detail: "every feed named for it was checked recently and had no video" };
  }

  // Not checked this run is settled as far as picking goes: pickAutoAdd waits
  // on a stronger stream still "pending", and one left for a later run must
  // not hold up one that played now.
  const checkIds = new Set(toCheck.map((c) => c.id));
  let checks: Record<number, VerifyState> = Object.fromEntries(
    named.map((c) => [c.id, checkIds.has(c.id) ? ({ status: "queued" } as VerifyState) : { status: "error", reason: "not checked this run" }])
  );
  let pick: GameStreamCandidate | null = null;
  for (const c of toCheck) {
    if (checks[c.id]?.status !== "queued") continue; // its provider answered busy for another stream
    const result = await probeStream(c.id);
    checks = applyResult(checks, named, c.id, result);
    if (result.status === "dead") deadSince.set(c.id, Date.now());
    pick = pickAutoAdd(named, checks, PREP_MAX_SCORE);
    if (pick) break;
  }
  if (!pick) {
    const tally = toCheck.map((c) => checks[c.id]?.status ?? "queued").join("/");
    return { action: "nothing-plays-yet", detail: `checked ${toCheck.length}: ${tally}` };
  }

  const res = await promoteStream({ streamId: pick.id, name: pick.name, logoUrl: pick.logoUrl, fixtureId: game.id, auto: true });
  if (res.status !== 200) return { action: "failed", detail: `${pick.name}: ${res.body.error ?? `HTTP ${res.status}`}` };
  return {
    action: res.body.jellyfinId ? "added" : "joining",
    detail: res.body.existing ? `${pick.name} (already in the lineup)` : pick.name,
  };
}
