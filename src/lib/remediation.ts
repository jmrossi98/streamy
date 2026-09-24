/**
 * The allowlist of things the assistant may offer to do -- and nothing that
 * does them.
 *
 * Deliberately free of imports. The chat UI is a client component and needs
 * parseProposal to decide whether to render a button, so anything that reaches
 * Portainer or Prisma lives in remediationRunner.ts instead. Keeping the
 * boundary description here and the boundary crossing there also means the
 * rules can be unit-tested without a database.
 *
 * Why an allowlist at all, rather than tools or a shell:
 *
 *   1. It is HERE, in code -- not in the model's prompt. A model can only name
 *      an id that already exists; anything else is rejected before a request
 *      leaves the process. Jailbreaking the model does not widen the list,
 *      because the model was never what bounded it.
 *
 *   2. The model proposes; a human confirms. Nothing runs from a model turn.
 *      That matters because this assistant reads *untrusted text* all day --
 *      container logs, release names, indexer responses. A release named to
 *      look like an instruction already reaches the model's context. If the
 *      model held the trigger, that release name would hold the trigger.
 *      Behind a tap, the worst an injection does is render a button nobody
 *      presses.
 *
 *   3. Every action is idempotent and reversible. Restarting a container is a
 *      thing you can do twice for no new consequence. Nothing here deletes
 *      media, touches /data, or takes free-form text that becomes part of a
 *      command -- there is no shell on this path at all.
 *
 *   4. The container safelist excludes the three whose restart could strand
 *      the admin: gluetun (whose namespace the *arrs and qBittorrent share),
 *      tailscale-exit (the route home), and jellyfin (someone may be mid-film).
 *      Those still need a human at Portainer, which is the status quo.
 */

/**
 * Containers this app may restart.
 *
 * Restarting any of these is, at worst, a brief outage of one service that
 * comes back by itself. The three deliberately absent are in this file's
 * header, with the reason.
 */
export const RESTARTABLE_CONTAINERS = [
  "flaresolverr",
  "prowlarr",
  "radarr",
  "sonarr",
  "sabnzbd",
  "gamarr",
  "dispatcharr",
] as const;

export type RemediationResult = { ok: boolean; detail: string };

export type RemediationSpec = {
  id: string;
  /** What the confirm button reads, once the target is filled in. */
  label: (target: string) => string;
  /**
   * Allowed targets. An action with a fixed list can only be invoked with one
   * of them; null means the action takes no target at all.
   */
  targets: readonly string[] | null;
  /** Seconds before this action may run again against the same target. */
  cooldownSec: number;
};

export const ACTIONS: Record<string, RemediationSpec> = {
  "container.restart": {
    id: "container.restart",
    label: (t) => `Restart ${t}`,
    targets: RESTARTABLE_CONTAINERS,
    // Long enough that a confirm-button mash can't become the restart loop the
    // README already documents: a healthcheck that cannot pass, plus autoheal,
    // produced a three-minute cycle.
    cooldownSec: 120,
  },
};

/**
 * Validates a proposal against the allowlist.
 *
 * Returns null when the action or target isn't one this app offers -- the case
 * a jailbroken or simply confused model lands in. A plain rejection, not an
 * error worth forwarding to the box.
 */
export function resolveAction(
  actionId: unknown,
  target: unknown
): { action: RemediationSpec; target: string } | null {
  if (typeof actionId !== "string") return null;
  const action = ACTIONS[actionId];
  if (!action) return null;

  if (action.targets === null) return { action, target: "" };
  if (typeof target !== "string") return null;
  if (!action.targets.includes(target)) return null;
  return { action, target };
}

/**
 * Pulls an action proposal out of a model's reply.
 *
 * Text, not tool-calling, because this panel has three backends and one is a
 * 3B model on the admin's own GPU -- function-calling support across that
 * spread is not something to build a safety boundary on. It doesn't need to be
 * reliable either: a malformed or invented proposal simply renders no button,
 * and the allowlist rejects it again server-side if it somehow reaches the
 * route.
 */
export function parseProposal(text: string): { actionId: string; target: string } | null {
  const match = text.match(/```streamy-action\s*\n([\s\S]*?)```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as { action?: unknown; target?: unknown };
    const resolved = resolveAction(parsed.action, parsed.target ?? "");
    if (!resolved) return null;
    return { actionId: resolved.action.id, target: resolved.target };
  } catch {
    return null;
  }
}

/**
 * The reply with the proposal block stripped out.
 *
 * The block is machine-readable scaffolding, not something to show the admin
 * -- they get a button instead. A half-streamed block is also stripped, so the
 * raw JSON never flashes up mid-stream and then vanishes.
 */
export function stripProposal(text: string): string {
  return text.replace(/```streamy-action[\s\S]*?(?:```|$)/g, "").trimEnd();
}
