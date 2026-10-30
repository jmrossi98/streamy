/**
 * Removes channels that were added for a game once that game is over.
 *
 * The decision per channel is gameChannelCleanupRules.ts; this gathers its
 * inputs (the recorded channels, today's schedule, Dispatcharr's lineup and
 * who is watching what) and acts on the answers. Runs from the download
 * warden's ten-minute pass -- see downloadWarden.ts for why that pass also
 * carries work that is not download recovery.
 *
 * Never throws: a failed step leaves channels in place for the next pass,
 * which is always the safe direction.
 */
import { prisma } from "@/lib/db";
import { activeChannelKeys, demoteChannel, isDispatcharrConfigured, listChannels } from "./dispatcharr";
import { refreshGuide } from "./liveTv";
import { getTodaysFixtures, type Fixture } from "./sportsSchedule";
import { decideGameChannel } from "./gameChannelCleanupRules";
import { channelKey } from "./liveChannelStateRules";

export type GameChannelCleanupReport = {
  /** Recorded game channels looked at this pass. */
  checked: number;
  removed: { name: string; reason: string }[];
  /** Removals Dispatcharr refused; their records stay for the next pass. */
  failed: { name: string; error: string }[];
  /** Whether Jellyfin accepted the guide refresh; null when none was needed. */
  refreshed: boolean | null;
};

/** How recent a tab's heartbeat must be for its "playing" to count (presenceOf's idle window). */
const PLAYING_SEEN_MS = 5 * 60_000;

/** channelKeys of live channels a Streamy tab has reported playing in the last few minutes. */
async function liveChannelsPlayingInStreamy(now: Date): Promise<Set<string>> {
  const rows = await prisma.viewerSession.findMany({
    where: { lastSeenAt: { gte: new Date(now.getTime() - PLAYING_SEEN_MS) }, playing: { not: null } },
    select: { playing: true },
  });
  const keys = new Set<string>();
  for (const r of rows) {
    try {
      const p = JSON.parse(r.playing!) as { kind?: string; title?: string };
      if (p.kind === "live" && p.title) keys.add(channelKey(p.title));
    } catch {
      // A malformed row says nothing.
    }
  }
  return keys;
}

export async function runGameChannelCleanup(now: Date = new Date()): Promise<GameChannelCleanupReport> {
  const report: GameChannelCleanupReport = { checked: 0, removed: [], failed: [], refreshed: null };
  if (!isDispatcharrConfigured()) return report;

  const rows = await prisma.gameChannel.findMany();
  report.checked = rows.length;
  // Most passes: nothing recorded, so nothing else is worth asking.
  if (rows.length === 0) return report;

  const [fixtures, channels, active, streamyWatching] = await Promise.all([
    getTodaysFixtures().catch(() => [] as Fixture[]),
    listChannels(),
    activeChannelKeys(),
    liveChannelsPlayingInStreamy(now).catch(() => new Set<string>()),
  ]);
  const stateById = new Map(fixtures.map((f) => [f.id, f.state]));
  const channelById = channels ? new Map(channels.map((c) => [c.id, c])) : null;

  let changedLineup = false;
  for (const row of rows) {
    const channel = channelById?.get(row.channelId);
    // The proxy names a playing channel by UUID; the numeric id is checked too
    // in case a Dispatcharr version reports that instead.
    const inUse = active
      ? !!channel && (active.has(String(channel.id)) || (!!channel.uuid && active.has(channel.uuid)))
      : null;
    const decision = decideGameChannel(row, {
      fixtureState: stateById.get(row.fixtureId) ?? null,
      scheduleAvailable: fixtures.length > 0,
      channelExists: channelById ? channelById.has(row.channelId) : null,
      inUse,
      watchedInStreamy: streamyWatching.has(channelKey(channel?.name ?? row.name)),
      now,
    });

    try {
      if (decision.action === "mark-ended") {
        await prisma.gameChannel.update({ where: { channelId: row.channelId }, data: { endedSeenAt: now } });
      } else if (decision.action === "forget") {
        await prisma.gameChannel.delete({ where: { channelId: row.channelId } });
      } else if (decision.action === "remove") {
        if (await demoteChannel(row.channelId)) {
          await prisma.gameChannel.delete({ where: { channelId: row.channelId } });
          report.removed.push({ name: row.name, reason: decision.reason });
          changedLineup = true;
        } else {
          report.failed.push({ name: row.name, error: "Dispatcharr refused the delete" });
        }
      }
    } catch (err) {
      report.failed.push({ name: row.name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Once for the whole pass, not per channel: every refresh makes Jellyfin
  // re-enumerate its tuner, and three dead feeds from one game is the usual case.
  if (changedLineup) report.refreshed = await refreshGuide();
  if (report.removed.length) {
    console.log(
      `[game-channels] removed ${report.removed.length}: ${report.removed.map((r) => r.name).join(", ")}`
    );
  }
  return report;
}
