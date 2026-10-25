/**
 * The scheduled owner of every download-recovery path.
 *
 * ## Why this exists
 *
 * Streamy had all the recovery logic it needed and no reliable way to run it.
 * The stalled-download healer and the ordered episode-search drain were both
 * kicked only from a page render (`/admin/downloads`) or `/api/requests/check`,
 * and both are allowed to give up part-way: the drain logs "leaving the rest
 * for the next pass" when Sonarr is busy, and the healer skips a title still
 * inside its cooldown. That is correct behaviour and it is fine -- as long as
 * a next pass actually comes.
 *
 * It did not. Nobody loads the admin downloads page on a schedule, so "the
 * next pass" meant "whenever a human next happens to look". A season queued in
 * the morning was found hours later with forty-five episodes waiting and
 * `attempts` still at zero: not failing, never started. Every recurrence of
 * "downloads are stuck again" traces back to that one gap rather than to a new
 * bug each time, which is why fixing them one at a time never held.
 *
 * So the fix is not more healing logic. It is a caller that always comes back.
 * This runs on a schedule (see the download-warden cron route and workflow),
 * awaits each pass instead of firing and forgetting, and reports what it found
 * so a queue that stops moving is visible rather than silent.
 *
 * The page-load kicks stay. They make things feel immediate when someone is
 * looking; this makes them correct when nobody is.
 */
import { adoptUnsearchedEpisodes, drainEpisodeSearchesNow, importManualPackFiles } from "./sonarr";
import { healStalledDownloads } from "./downloadHealer";
import { pendingSearchStats, type QueueStats } from "./pendingEpisodeSearch";
import { isQueueStuck } from "./searchQueueRules";
import { runServiceWatch, type ServiceWatchReport } from "./serviceWatch";
import { runGameChannelCleanup, type GameChannelCleanupReport } from "./gameChannelCleanup";

export type WardenReport = {
  ranAt: string;
  /** Titles the healer re-grabbed or re-searched this pass. */
  healed: { title: string; reason: string }[];
  /** Wanted episodes found never searched and put back in the queue. */
  adopted: number;
  /** The episode-search queue before the drain, and after it. */
  queueBefore: QueueStats;
  queueAfter: QueueStats;
  /** True when the queue is old enough to count as stuck. */
  stuck: boolean;
  /** Anything that threw, by the step that threw it. */
  errors: { step: string; error: string }[];
  /** Which services were answering this pass; null if that check failed. */
  services: ServiceWatchReport | null;
  /** Game-page channels removed after their game; null if that step failed. */
  gameChannels: GameChannelCleanupReport | null;
};

/**
 * How long a drain may run before leaving the rest to the next pass.
 *
 * The route allows 300s and the caller gives up at 290s, so the whole pass has
 * to finish inside that with room for the heal afterwards. An unbounded drain
 * overran it: a queue of 55 episodes is about twenty minutes of real indexer
 * searching, and the request timed out mid-pass every time.
 *
 * Stopping early costs nothing now. The queue is persisted and the next pass
 * is ten minutes away, which is the guarantee this whole file exists to make.
 */
const DRAIN_BUDGET_MS = 180_000;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * One full recovery pass. Never throws: a failing step is reported and the
 * others still run, because the steps are independent and a Sonarr outage
 * should not stop the healer from rescuing a stalled torrent.
 */
export async function runDownloadWarden(): Promise<WardenReport> {
  const errors: { step: string; error: string }[] = [];

  const queueBefore = await pendingSearchStats().catch((err) => {
    errors.push({ step: "queueStats", error: message(err) });
    return { total: 0, oldestWaitMinutes: 0, series: 0, retrying: 0 };
  });

  // Lost queue writes are put back before the drain, so it works on them now.
  const adopted = await adoptUnsearchedEpisodes().catch((err) => {
    errors.push({ step: "adopt", error: message(err) });
    return 0;
  });

  // Not download recovery either (see `services` below for the same call):
  // channels added from a game page outlive the game, and this is the pass
  // that reliably comes back to remove them. Run before the drain rather than
  // after it because it is a few quick requests and the drain is the step
  // that can use up the route's time budget.
  const gameChannels = await runGameChannelCleanup().catch((err) => {
    errors.push({ step: "gameChannels", error: message(err) });
    return null;
  });

  // Drain first, heal second, and the order is load-bearing.
  //
  // The healer fires one bulk EpisodeSearch covering every wanted-but-idle
  // episode, and the drain refuses to add work while a search is outstanding.
  // Healing first would therefore guarantee the drain is blocked by the
  // command the heal just issued -- the exact starvation this change exists
  // to end. The ordered queue is the more urgent of the two anyway: it is a
  // season somebody explicitly asked for, where the healer's idle re-search
  // is background repair.
  //
  // Awaited on purpose. The page-load caller cannot wait for a season and so
  // fires this off unobserved; here the whole point is to know whether the
  // pass actually moved anything.
  await drainEpisodeSearchesNow(DRAIN_BUDGET_MS).catch((err) => {
    errors.push({ step: "drain", error: message(err) });
    return false;
  });

  const healed = await healStalledDownloads().catch((err) => {
    errors.push({ step: "heal", error: message(err) });
    return [];
  });

  // Finished files of hand-added season packs into the library -- see manualPackRules.ts.
  await importManualPackFiles().catch((err) => {
    errors.push({ step: "packImport", error: message(err) });
    return 0;
  });

  const queueAfter = await pendingSearchStats().catch((err) => {
    errors.push({ step: "queueStats", error: message(err) });
    return queueBefore;
  });

  const stuck = isQueueStuck(queueBefore, queueAfter);

  // Not download recovery, but this pass is the one thing here that runs on
  // time every ten minutes, which is what watching for a down service needs.
  const services = await runServiceWatch().catch((err) => {
    errors.push({ step: "services", error: message(err) });
    return null;
  });

  return {
    ranAt: new Date().toISOString(),
    healed,
    adopted,
    queueBefore,
    queueAfter,
    stuck,
    errors,
    services,
    gameChannels,
  };
}
