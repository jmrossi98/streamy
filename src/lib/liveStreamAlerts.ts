/**
 * Emails the admin when a live stream fails someone (liveStreamAlertRules.ts
 * has the rules). Through notify(), the same SNS topic as every other alert.
 *
 * Driven by the presence heartbeat rather than a cron: that is where the
 * evidence arrives, and the app has no scheduler of its own. Two triggers:
 *
 *   - every heartbeat, throttled to one check per CHECK_EVERY_MS for the
 *     whole process, so a stall streak is reported while it is happening;
 *   - a timer set when a heartbeat brings a live start that ended without a
 *     picture, firing once RECOVERED_START_MS has passed. A failed tune is
 *     only final after that wait, and the person who hit it has often closed
 *     the tab by then -- no more heartbeats from them to trigger a check.
 *
 * Fire-and-forget from the route: nothing here may slow or fail a heartbeat.
 */
import { prisma } from "./db";
import { isNotifyConfigured, notify } from "./notify";
import { readLiveEvents } from "./liveChannelState";
import { LIVE_MEDIA_PREFIX } from "./liveChannelStateRules";
import {
  ALERT_DEDUPE_MS,
  ALERT_LOOKBACK_MS,
  alertMessage,
  incidentsToAlert,
  streamIncidents,
} from "./liveStreamAlertRules";
import { RECOVERED_START_MS, type IncomingEvent } from "./viewerActivityRules";
import { HOUSE_TIME_ZONE } from "./streamLoadHistoryRules";

const CHECK_EVERY_MS = 15_000;
let lastCheck = 0;
let running: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

async function check(now: number): Promise<void> {
  // A little more than the lookback, so a failed tune whose first try began
  // before the window is still read whole.
  const events = await readLiveEvents(now - ALERT_LOOKBACK_MS - 10 * 60_000);
  const incidents = streamIncidents(events, now);
  if (incidents.length === 0) return;

  const keys = [...new Set(incidents.map((i) => i.key))];
  const rows = await prisma.liveChannelState.findMany({
    where: { key: { in: keys }, alertedAt: { gte: new Date(now - ALERT_DEDUPE_MS) } },
    select: { key: true, alertedAt: true },
  });
  const lastAlertedAt = new Map(rows.map((r) => [r.key, r.alertedAt!.getTime()]));
  const toSend = incidentsToAlert(incidents, lastAlertedAt, now);
  if (toSend.length === 0) return;

  // Recorded before sending: a failed publish then costs one alert, where
  // recording after would let a slow SNS call race the next check into
  // sending the same one twice.
  const at = new Date(now);
  await Promise.all(
    toSend.map((i) =>
      prisma.liveChannelState.upsert({
        where: { key: i.key },
        create: { key: i.key, name: i.channel, alertedAt: at },
        update: { name: i.channel, alertedAt: at },
      })
    )
  );
  const { subject, body } = alertMessage(toSend, { baseUrl: process.env.NEXTAUTH_URL ?? null, timeZone: HOUSE_TIME_ZONE });
  const sent = await notify(subject, body);
  console.log(
    `[live-alerts] ${sent ? "sent" : "NOT sent"}: ${toSend.map((i) => `${i.channel} (${i.kind}, ${i.userName})`).join("; ")}`
  );
}

function runCheck(): void {
  if (running) return;
  const now = Date.now();
  lastCheck = now;
  running = check(now)
    .catch((err) => console.error("[live-alerts] check failed:", err))
    .finally(() => {
      running = null;
    });
}

/** Whether a heartbeat's events include a live tune that may have failed. */
function hasLiveFailureSignal(events: IncomingEvent[]): boolean {
  return events.some(
    (e) => e.media.startsWith(LIVE_MEDIA_PREFIX) && (e.kind === "stop" || e.kind === "error" || e.kind === "retry")
  );
}

/** Called for every heartbeat after its events are stored. Never throws, never waits. */
export function onPresenceRecorded(events: IncomingEvent[]): void {
  try {
    if (!isNotifyConfigured()) return;
    if (hasLiveFailureSignal(events)) {
      // Re-armed on each new signal, so the check waits for the latest
      // failure to become final, not just the first.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        runCheck();
      }, RECOVERED_START_MS + 5_000);
      // Never what keeps the process alive.
      timer.unref?.();
    }
    if (Date.now() - lastCheck >= CHECK_EVERY_MS) runCheck();
  } catch (err) {
    console.error("[live-alerts] schedule failed:", err);
  }
}
