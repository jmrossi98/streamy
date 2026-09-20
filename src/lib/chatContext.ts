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
import {
  containerProblems,
  staleNamespaceBindings,
  type ContainerState,
} from "./containers";

/** Ordered so the things most likely to be broken are read first. */
const STATE_ORDER: Record<ServiceStatus["state"], number> = {
  down: 0,
  unknown: 1,
  up: 2,
  unconfigured: 3,
};

/**
 * Caps how much of a log excerpt reaches the prompt.
 *
 * getContainerLogs() already bounds line count at the source (60), but a
 * single unbroken line -- a stack trace, a JSON blob some services log as one
 * line -- can still be huge. This is a second, character-based ceiling on top
 * of that one.
 */
const MAX_LOG_EXCERPT_CHARS = 2000;

/**
 * The container section, or "" when there is nothing worth saying.
 *
 * Only faults are rendered. Twenty healthy container lines in a 3B model's
 * context makes its answers worse, not better -- it tries to account for all
 * of them instead of the one that is broken.
 *
 * `null` means Portainer could not be read, which is reported as such. Silently
 * omitting the section would let "we could not look" read as "nothing is
 * wrong", the same mistake as reporting an unverifiable VPN as healthy.
 *
 * `logs` is already-fetched text, keyed by container name -- this function
 * stays pure (no I/O) so it can be unit-tested without a network, matching
 * every other function in this file. Fetching lives in chatStatus.ts.
 */
function containerSection(
  containers: ContainerState[] | null,
  logs: Record<string, string> = {}
): string {
  if (containers === null) return "";
  if (containers.length === 0) {
    return "\n\nContainer state: could not be read.";
  }

  const stale = staleNamespaceBindings(containers);
  const problems = containerProblems(containers).filter(
    (c) => !stale.some((s) => s.name === c.name)
  );

  if (stale.length === 0 && problems.length === 0) {
    return `\n\nAll ${containers.length} containers are running.`;
  }

  const logExcerpt = (name: string): string => {
    const text = logs[name];
    if (!text) return "";
    const trimmed =
      text.length > MAX_LOG_EXCERPT_CHARS
        ? "…(truncated)…\n" + text.slice(-MAX_LOG_EXCERPT_CHARS)
        : text;
    return `\n  Recent log lines for ${name}:\n  \`\`\`\n${trimmed.trimEnd()}\n  \`\`\``;
  };

  const lines: string[] = [];
  for (const c of problems) {
    lines.push(
      `- ${c.name}: ${c.state}${c.health === "unhealthy" ? " (unhealthy)" : ""} — ${c.status || "no status"}` +
        logExcerpt(c.name)
    );
  }
  // Called out separately because it is invisible to every other signal: the
  // container is running, its own healthcheck may pass, and it has no network
  // at all. Recreating is the only fix -- restarting re-enters the dead
  // namespace and fails.
  for (const c of stale) {
    lines.push(
      `- ${c.name}: RUNNING BUT HAS NO NETWORK — it shares a network namespace ` +
        `with a container that no longer exists. It must be RECREATED, not ` +
        `restarted; restarting re-enters the dead namespace and fails.` +
        logExcerpt(c.name)
    );
  }

  return (
    "\n\n--- BEGIN CONTAINER PROBLEMS ---\n" +
    lines.join("\n") +
    "\n--- END CONTAINER PROBLEMS ---\n" +
    "These are container-level faults on mediabox, including their own recent " +
    "log lines where available -- read them for the actual error before " +
    "guessing at a cause. When one explains a failing service above, say so " +
    "and tell the admin to restart or recreate it in Portainer. You cannot " +
    "restart anything yourself."
  );
}

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
 *
 * `containers` defaults to null -- "not looked at" -- so every existing caller
 * and test keeps its exact previous output.
 *
 * `logs` is recent output for whichever flagged containers chatStatus.ts
 * fetched it for (see containerSection) -- always safe to omit, since it is
 * only ever consulted for names that also appear in `containers`.
 */
export function buildStatusContext(
  statuses: ServiceStatus[],
  containers: ContainerState[] | null = null,
  logs: Record<string, string> = {}
): ChatMessage {
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
      `--- BEGIN STACK STATUS ---\n${body}\n--- END STACK STATUS ---` +
      containerSection(containers, logs),
  };
}
