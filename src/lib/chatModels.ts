/**
 * Which model answers a given admin chat turn.
 *
 * Three backends, picked by hand in the panel rather than routed automatically.
 * The choice is deliberate: an automatic router either guesses wrong on cost
 * (escalating a "is Jellyfin up" to a frontier model) or guesses wrong on
 * quality (answering an architecture question with a 3B model), and neither
 * failure is visible from the transcript. A switch makes the tradeoff explicit
 * and the bill predictable.
 *
 * Pure, so it tests without the server stack. Model *ids* live here; whether a
 * backend is actually reachable is a server-side question (see openrouter.ts
 * and ollama.ts), because it depends on env this module deliberately doesn't
 * read.
 */

export type ChatBackendId = "local" | "open" | "claude";

/**
 * What the picker starts on: the open-weight slot.
 *
 * It is the point of the hybrid -- strong enough to be worth asking, cheap
 * enough (fractions of a cent per exchange) that the panel is not something to
 * think twice about opening. Local is a better *fallback* than it is a
 * default: a 3B model answering a real question confidently and wrongly costs
 * more time than the tokens saved.
 *
 * Deliberately the slot, not the model. Which open-weight model this resolves
 * to is OPENROUTER_OPEN_MODEL's business (see openrouter.ts), so swapping
 * DeepSeek for something else never touches this file.
 */
export const DEFAULT_BACKEND: ChatBackendId = "open";

/**
 * Where an unrecognised backend lands, which is NOT the default above.
 *
 * The panel names the backend on every request, so a value that isn't one of
 * ours means a malformed or stale request -- and resolving that to a metered
 * model would let junk input spend money. The free local model is the only
 * safe place for it to land, whatever the picker happens to start on.
 */
export const FALLBACK_BACKEND: ChatBackendId = "local";

export type ChatBackend = {
  id: ChatBackendId;
  /** Shown in the picker. */
  label: string;
  /** One line under the picker, so the cost tradeoff isn't invisible. */
  hint: string;
  /** Which client the route dispatches to. */
  provider: "ollama" | "openrouter";
};

export const CHAT_BACKENDS: readonly ChatBackend[] = [
  {
    id: "local",
    label: "Local",
    hint: "Runs on your own hardware. Free, small, offline-capable.",
    provider: "ollama",
  },
  {
    id: "open",
    label: "Open",
    hint: "Open-weight model via OpenRouter. Cheap, much stronger than local.",
    provider: "openrouter",
  },
  {
    id: "claude",
    label: "Claude",
    hint: "Frontier model via OpenRouter. Best answers, most expensive.",
    provider: "openrouter",
  },
];

/**
 * The model id sent upstream for each OpenRouter-backed choice.
 *
 * Overridable by env because OpenRouter's catalogue moves faster than this
 * repo does -- a model can be retired or superseded between deploys, and
 * swapping a secret is quicker than shipping a release to fix a 404.
 *
 * `anthropic/claude-sonnet` (no version) would also resolve, but pinning is
 * deliberate: the unversioned alias silently follows the family to whatever is
 * newest, which moves the per-token price under you without a deploy.
 */
export const DEFAULT_OPEN_MODEL = "deepseek/deepseek-v3.2";
export const DEFAULT_CLAUDE_MODEL = "anthropic/claude-sonnet-4.6";

/**
 * Same-tier failover for the Claude slot only.
 *
 * The open slot has no default chain on purpose: the strong open-weight ids
 * move faster than this repo, and a stale id is a silent skip rather than an
 * error. Set OPENROUTER_OPEN_FALLBACKS (comma-separated) to add one.
 */
export const DEFAULT_CLAUDE_FALLBACKS = "anthropic/claude-sonnet-4.5";

/**
 * Coerces the browser's requested backend to a known one.
 *
 * The panel sends this, and the panel is data -- an unrecognised value must
 * land on the free local model rather than being passed through to a provider,
 * which is how a typo'd model id turns into a billing surprise. Note this
 * resolves to FALLBACK_BACKEND, not DEFAULT_BACKEND: what the picker opens on
 * and where junk input lands are different questions, and only the second one
 * is a spending decision made by something other than a person.
 */
export function normalizeBackend(value: unknown): ChatBackendId {
  return CHAT_BACKENDS.some((b) => b.id === value)
    ? (value as ChatBackendId)
    : FALLBACK_BACKEND;
}

export function backendById(id: ChatBackendId): ChatBackend {
  // normalizeBackend guarantees a hit; the fallback is for callers that didn't.
  return CHAT_BACKENDS.find((b) => b.id === id) ?? CHAT_BACKENDS[0];
}

/** Whether this choice goes out to OpenRouter rather than the local card. */
export function isRemoteBackend(id: ChatBackendId): boolean {
  return backendById(id).provider === "openrouter";
}
