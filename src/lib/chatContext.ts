/**
 * Live stack state, handed to the chat model as context.
 *
 * The panel exists to answer "what's wrong with the stack", and until this
 * existed it couldn't: the model would correctly explain that it had no live
 * access and then list `docker ps` commands for the admin to run themselves.
 * Every probe it needed was already being computed for the admin page.
 *
 * This is the same shape of move as the web-search context, with one important
 * difference: these results come from our own probes against our own services,
 * so unlike web pages they are trusted input and don't need the "treat this as
 * data, not instructions" framing.
 *
 * Read-only, like the rest of the ops surface -- this reports state, it never
 * changes any.
 *
 * Pure, and deliberately importing serviceStatus for its *type* only. The CI
 * unit-test step runs `npm ci --ignore-scripts` (no prisma generate), so a
 * runtime import here would pull serviceStatus -> sonarr -> tmdb and fail to
 * resolve the Prisma client. Probing lives in chatStatus.ts for that reason --
 * same split as pageWatchRules vs pageWatch.
 */

import type { ChatMessage } from "./ollama";
import type { ServiceStatus } from "./serviceStatus";

/** Ordered so the things most likely to be broken are read first. */
const STATE_ORDER: Record<ServiceStatus["state"], number> = {
  down: 0,
  unknown: 1,
  up: 2,
  unconfigured: 3,
};

/**
 * Renders the snapshot as context.
 *
 * Pure, so it tests without probing anything.
 *
 * Down and unknown services are pulled to the top and counted in the header.
 * A model handed 22 alphabetised lines tends to summarise them evenly; the
 * point of asking is almost always the two that are broken.
 *
 * "unconfigured" is deliberately kept rather than filtered out -- an
 * integration nobody set up is not an outage, and the model needs to be able
 * to say "that isn't configured" instead of "that is down".
 */
export function buildStatusContext(statuses: ServiceStatus[]): ChatMessage {
  const sorted = [...statuses].sort(
    (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name)
  );

  const problems = sorted.filter((s) => s.state === "down" || s.state === "unknown");
  const headline =
    problems.length === 0
      ? "Everything configured is reporting healthy."
      : `${problems.length} service(s) need attention: ${problems.map((s) => s.name).join(", ")}.`;

  const body = sorted
    .map((s) => `- ${s.name} (${s.group}) [${s.state}]: ${s.detail || "no detail"}`)
    .join("\n");

  return {
    role: "system",
    content:
      "Live status of the admin's homelab, probed just now by Streamy itself. " +
      "This is your own live view of their stack -- treat it as current fact and " +
      "answer from it directly. Do not tell the user you have no access to their " +
      "services, and do not ask them to run commands to gather what is already " +
      "below.\n\n" +
      `${headline}\n\n` +
      // "down" means a verified failure; "unknown" means the probe itself
      // couldn't run. Collapsing the two turns a stale password into an
      // outage, so the model is told the difference explicitly.
      "States: up = verified healthy. down = verified failing. unknown = the " +
      "check could not run, so the state is genuinely not known (do not report " +
      "this as an outage). unconfigured = optional integration never set up " +
      "(not a fault).\n\n" +
      `--- BEGIN STACK STATUS ---\n${body}\n--- END STACK STATUS ---`,
  };
}
