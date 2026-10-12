/**
 * Alerts when a service has stopped answering, without anyone watching the
 * panel. See serviceWatchRules.ts for why and for what counts.
 *
 * Runs on the download warden's pass, which mediabox's cron calls every ten
 * minutes -- the one schedule here that fires on time. The streaks live in
 * this process: Streamy is a single Node server, and a restart costs at most
 * one repeated alert.
 */
import { isNotifyConfigured, notify } from "./notify";
import { EMPTY_WATCH, watchServices, type WatchState, type WatchedService } from "./serviceWatchRules";

let watch: WatchState = EMPTY_WATCH;

export type ServiceWatchReport = { checked: number; down: string[]; newlyDown: string[]; recovered: string[] };

export async function runServiceWatch(): Promise<ServiceWatchReport> {
  // Loaded here, not at the top: serviceStatus pulls in most of the app.
  const { getServiceStatuses } = await import("./serviceStatus");
  const statuses: WatchedService[] = await getServiceStatuses();
  const outcome = watchServices(watch, statuses);
  watch = outcome.state;

  if (isNotifyConfigured()) {
    if (outcome.newlyDown.length > 0) {
      await notify(
        `Service down: ${outcome.newlyDown.map((s) => s.name).join(", ")}`,
        outcome.newlyDown.map((s) => `${s.name}: ${s.detail}`).join("\n") +
          "\n\nDown on two checks in a row, ten minutes apart. You will hear again when it is back."
      );
    }
    if (outcome.recovered.length > 0) {
      await notify(`Service back up: ${outcome.recovered.join(", ")}`, "Answering again on the latest check.");
    }
  }

  return {
    checked: statuses.length,
    down: statuses.filter((s) => s.state === "down").map((s) => s.name),
    newlyDown: outcome.newlyDown.map((s) => s.name),
    recovered: outcome.recovered,
  };
}
