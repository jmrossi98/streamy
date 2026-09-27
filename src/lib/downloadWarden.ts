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
import { drainEpisodeSearchesNow } from "./sonarr";
import { healStalledDownloads } from "./downloadHealer";
import { pendingSearchStats, type QueueStats } from "./pendingEpisodeSearch";
import { isQueueStuck } from "./searchQueueRules";

export type WardenReport = {
  ranAt: string;
  /** Titles the healer re-grabbed or re-searched this pass. */
  healed: { title: string; reason: string }[];
  /** The episode-search queue before the drain, and after it. */
  queueBefore: QueueStats;
  queueAfter: QueueStats;
  /** True when the queue is old enough to count as stuck. */
  stuck: boolean;
  /** Anything that threw, by the step that threw it. */
  errors: { step: string; error: string }[];
};

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

  // Healing first. It re-grabs stalled transfers and re-searches wanted-but-
  // idle titles, which is what frees up the Sonarr command queue that the
  // drain below backs off from.
  const healed = await healStalledDownloads().catch((err) => {
    errors.push({ step: "heal", error: message(err) });
    return [];
  });

  // Awaited on purpose. The page-load caller cannot wait for a season and so
  // fires this off unobserved; here the whole point is to know whether the
  // pass actually moved anything.
  await drainEpisodeSearchesNow().catch((err) => {
    errors.push({ step: "drain", error: message(err) });
    return false;
  });

  const queueAfter = await pendingSearchStats().catch((err) => {
    errors.push({ step: "queueStats", error: message(err) });
    return queueBefore;
  });

  const stuck = isQueueStuck(queueBefore, queueAfter);

  return {
    ranAt: new Date().toISOString(),
    healed,
    queueBefore,
    queueAfter,
    stuck,
    errors,
  };
}
