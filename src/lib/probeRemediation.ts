/**
 * Automatic repair attempts, triggered by probe results rather than by chat.
 *
 * ## Why the trigger matters more than the action
 *
 * The admin assistant can already propose these, and a person confirms them.
 * That gate exists because the assistant ingests untrusted text all day --
 * container logs, release names, indexer responses. A torrent named to look
 * like an instruction reaches its context, which is exactly why the shared
 * context store separates `observed` from `confirmed`.
 *
 * Removing the confirm step for chat would turn a filename into a way to run
 * commands. Removing it *here* does not: a ProbeResult is a struct this
 * codebase produced from its own measurements -- "metrics-24h.json was last
 * written 9h ago" -- with no path for an outsider to influence the id being
 * matched. Same actions, same allowlist, same audit trail; a trusted trigger
 * instead of an untrusted one.
 *
 * ## Why so few probes have a fix
 *
 * Most do not have one that is safe, and inventing actions that do not help
 * would be worse than reporting:
 *
 *   - Stale published artifacts are written by cron jobs on mediabox. Nothing
 *     Streamy can reach restarts them, and restarting a container that does
 *     not produce the file would be theatre.
 *   - A wedged import is usually a release whose filename carries no episode
 *     number. That needs a human deciding which episode it is -- guessing
 *     would file a film under the wrong entry, which is worse than leaving it
 *     queued.
 *   - A re-grab loop is a code bug. Blocklisting the looping release treats
 *     the symptom and poisons a release that may be the best one available.
 *
 * So exactly one failure gets an automatic attempt, and the rest say plainly
 * that they were left alone.
 */
import { RESTARTABLE_CONTAINERS } from "./remediation";
import { isRemediationConfigured, runAction } from "./remediationRunner";
import type { ProbeResult } from "./healthProbeRules";

/** Recorded as the actor, so the audit log separates this from a person. */
const ACTOR = "health-probe";

/**
 * Containers worth restarting when search stops yielding releases, in order.
 *
 * FlareSolverr first: it is the usual culprit, it holds browser sessions that
 * go stale, and restarting it disturbs nothing else. Prowlarr second, and
 * only if the first did not help, because it is the thing every *arr talks to
 * and bouncing it interrupts any search in flight.
 */
const SEARCH_RECOVERY_ORDER = ["flaresolverr", "prowlarr"] as const;

export async function remediateProbeFailures(results: ProbeResult[]): Promise<string[]> {
  if (!isRemediationConfigured()) return [];

  const failed = new Set(results.filter((r) => r.status === "fail").map((r) => r.id));
  const done: string[] = [];

  if (failed.has("search.yields_results")) {
    for (const container of SEARCH_RECOVERY_ORDER) {
      // Defensive: these are constants above, but the allowlist is the
      // authority and a typo here should refuse rather than reach Portainer.
      if (!(RESTARTABLE_CONTAINERS as readonly string[]).includes(container)) continue;

      const result = await runAction(ACTOR, "container.restart", container);
      done.push(`restart ${container}: ${result.ok ? "ok" : `failed -- ${result.detail}`}`);
      // Stop at the first success. If restarting FlareSolverr fixed it,
      // bouncing Prowlarr as well only interrupts whatever recovered.
      if (result.ok) break;
    }
  }

  for (const id of failed) {
    if (id === "search.yields_results") continue;
    done.push(`${id}: no safe automatic fix -- ${whyNotFixable(id)}`);
  }

  return done;
}

function whyNotFixable(id: string): string {
  if (id.startsWith("freshness.")) {
    return "the publisher is a cron job on mediabox, not something Streamy can restart";
  }
  if (id === "stuck.imports") {
    return "the release needs a human to say which episode it is";
  }
  if (id === "stuck.regrab_loop") {
    return "this is a code bug; blocklisting the release would hide it and poison a good release";
  }
  return "no action is defined for this probe";
}
