/**
 * Which provider and model answer each of Streamy's cloud-model jobs.
 *
 * Two metered providers now: OpenRouter (one key, many vendors) and Anthropic
 * directly. The second exists because prepaid Anthropic credit is only
 * spendable on Anthropic's own API -- OpenRouter bills its own balance, so
 * routing Claude through it leaves the credit untouched.
 *
 * Every job that pays for tokens is a "use" here, and each use carries its
 * own route: a provider, a model id, and same-tier fallbacks. The routing is
 * admin-editable at runtime (stored as one JSON setting) with env-derived
 * defaults underneath, so a retired model id is a form edit, not a deploy.
 *
 * Pure. Which provider actually has a key is a server-side fact, passed in.
 */

export type LlmProvider = "openrouter" | "anthropic" | "claudecode";

/**
 * "claudecode" (2026-10-27) is not a metered API: it is Claude Code on
 * mediabox, signed in to the admin's Claude plan, reached through the skill
 * runner's /chat lane (claudeCodeLlm.ts). Usage comes out of the plan, not a
 * prepaid balance. Only the admin chat's Claude slot may use it -- it answers
 * with its own tools on mediabox and is far too slow for the batch jobs.
 */
export const LLM_PROVIDERS: readonly LlmProvider[] = ["openrouter", "anthropic", "claudecode"];

export const PROVIDER_LABELS: Record<LlmProvider, string> = {
  openrouter: "OpenRouter",
  anthropic: "Anthropic",
  claudecode: "Claude Code (your plan)",
};

/** The env var that enables each provider; shown when one is greyed out. */
export const PROVIDER_ENV: Record<LlmProvider, string> = {
  openrouter: "OPENROUTER_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  claudecode: "SKILL_RUNNER_URL",
};

/** Providers that take one model and no fallback chain. */
export function takesFallbacks(provider: LlmProvider): boolean {
  return provider !== "claudecode";
}

export type LlmUse = "chatClaude" | "chatOpen" | "resume" | "apply";

export type LlmUseInfo = {
  id: LlmUse;
  label: string;
  description: string;
  /**
   * Providers that can serve this use. The open-weight chat slot is
   * OpenRouter-only because Anthropic serves no open-weight models; routing
   * it to Claude would make the picker's "Open" button a lie.
   */
  providers: readonly LlmProvider[];
  /**
   * Where the use's controls live. 2026-10-24: the resume and apply-packet
   * models moved from the assistant's Model routing panel to an "AI models"
   * section on the Jobs tab, beside the work they pay for; the assistant
   * panel keeps only the chat slots. Same stored setting either way.
   */
  area: LlmArea;
};

export type LlmArea = "assistant" | "jobs";

export const LLM_USES: readonly LlmUseInfo[] = [
  {
    id: "chatClaude",
    label: "Assistant - Claude",
    description:
      "The admin chat's Claude slot, and the investigation loop it runs on stack questions.",
    providers: ["anthropic", "openrouter", "claudecode"],
    area: "assistant",
  },
  {
    id: "chatOpen",
    label: "Assistant - Open",
    description: "The admin chat's open-weight slot.",
    providers: ["openrouter"],
    area: "assistant",
  },
  {
    id: "resume",
    label: "Tailored resumes",
    description:
      "One resume per job listing, with web research. Long prompts; the model matters here.",
    providers: ["anthropic", "openrouter"],
    area: "jobs",
  },
  {
    id: "apply",
    label: "Apply packets",
    description: "Drafts answers to the questions an application form asks.",
    providers: ["anthropic", "openrouter"],
    area: "jobs",
  },
];

export const LLM_USE_IDS: readonly LlmUse[] = LLM_USES.map((u) => u.id);

/** The uses edited in one place: the assistant's panel or the Jobs tab. */
export function usesIn(area: LlmArea): LlmUse[] {
  return LLM_USES.filter((u) => u.area === area).map((u) => u.id);
}

/**
 * The routing with only some uses put back to their defaults. Each panel's
 * Reset covers its own rows: resetting the chat slots must not quietly reset
 * the resume model edited on the Jobs tab, and the other way round.
 */
export function resetUses(routing: LlmRouting, uses: readonly LlmUse[], defaults: LlmRouting): LlmRouting {
  const out = { ...routing };
  for (const use of uses) out[use] = defaults[use];
  return out;
}

/** A submitted list of uses, keeping only real ones. */
export function parseUseList(raw: unknown): LlmUse[] {
  return Array.isArray(raw) ? LLM_USE_IDS.filter((u) => raw.includes(u)) : [];
}

export type LlmRoute = {
  provider: LlmProvider;
  /** The model tried first. Provider-specific id. */
  model: string;
  /** Tried in order when the model above is unavailable. Same tier, please. */
  fallbacks: string[];
};

export type LlmRouting = Record<LlmUse, LlmRoute>;

/**
 * Anthropic's default: the current Opus. Chosen over the cheaper Sonnet
 * because this is the slot the admin escalates *to*; a cheaper first answer is
 * what the open-weight slot is for.
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

/** What the open slot lands on when nothing is configured anywhere. */
const LAST_RESORT_OPEN_MODEL = "deepseek/deepseek-v3.2";
const LAST_RESORT_OPENROUTER_CLAUDE = "anthropic/claude-sonnet-4.6";

/**
 * Shown as suggestions when the live model list can't be fetched. Current ids
 * only; a retired one here would be offered as a working choice.
 */
export const ANTHROPIC_MODEL_SUGGESTIONS: readonly string[] = [
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
  "claude-opus-4-8",
  "claude-sonnet-4-6",
];

/** Claude Code takes an alias or a full id via --model; omitted is its default. */
export const DEFAULT_CLAUDE_CODE_MODEL = "sonnet";

export const CLAUDE_CODE_MODEL_SUGGESTIONS: readonly string[] = ["sonnet", "opus", "haiku"];

export const OPENROUTER_MODEL_SUGGESTIONS: readonly string[] = [
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-opus-4.6",
  "deepseek/deepseek-v3.2",
  "openai/gpt-5.1",
  "google/gemini-3-pro-preview",
  "qwen/qwen3-235b-a22b-2507",
];

/** Everything the defaults depend on, so the pure part never reads env. */
export type RoutingEnv = {
  configured: Record<LlmProvider, boolean>;
  /** Default chain per provider for the Claude-tier uses (none given: the built-in default). */
  claude: Partial<Record<LlmProvider, string[]>>;
  /** Default OpenRouter chain for the open-weight slot. */
  open: string[];
};

const MODEL_ID = /^[A-Za-z0-9][\w./:@-]{0,119}$/;

/** A plausible model id: no spaces, no shell, bounded. Not "exists upstream". */
export function isValidModelId(value: unknown): value is string {
  return typeof value === "string" && MODEL_ID.test(value);
}

function dedupe(fallbacks: string[], model: string): string[] {
  return [...new Set(fallbacks)].filter((m) => m !== model);
}

function routeFromChain(provider: LlmProvider, chain: string[], lastResort: string): LlmRoute {
  const [model = lastResort, ...rest] = chain.filter(isValidModelId);
  return { provider, model, fallbacks: dedupe(rest, model) };
}

export function infoFor(use: LlmUse): LlmUseInfo {
  return LLM_USES.find((u) => u.id === use) ?? LLM_USES[0];
}

/**
 * The provider a use lands on with nothing saved. Anthropic when its key is
 * set -- that key being set is the signal there is credit to use -- else
 * OpenRouter. Never Claude Code: that is a deliberate choice in the panel. With neither configured the route still has to name one; it
 * names the first the use allows, and the caller finds nothing configured.
 */
export function defaultProviderFor(use: LlmUse, env: RoutingEnv): LlmProvider {
  const allowed = infoFor(use).providers;
  if (allowed.includes("anthropic") && env.configured.anthropic) return "anthropic";
  if (allowed.includes("openrouter") && env.configured.openrouter) return "openrouter";
  return allowed[0];
}

/** The env-derived route for a use on a specific provider. */
export function providerDefaultRoute(use: LlmUse, provider: LlmProvider, env: RoutingEnv): LlmRoute {
  if (use === "chatOpen") return routeFromChain("openrouter", env.open, LAST_RESORT_OPEN_MODEL);
  if (provider === "claudecode") {
    return routeFromChain(provider, (env.claude.claudecode ?? []).slice(0, 1), DEFAULT_CLAUDE_CODE_MODEL);
  }
  return routeFromChain(
    provider,
    env.claude[provider] ?? [],
    provider === "anthropic" ? DEFAULT_ANTHROPIC_MODEL : LAST_RESORT_OPENROUTER_CLAUDE
  );
}

export function defaultRouting(env: RoutingEnv): LlmRouting {
  const out = {} as LlmRouting;
  for (const use of LLM_USE_IDS) {
    out[use] = providerDefaultRoute(use, defaultProviderFor(use, env), env);
  }
  return out;
}

function isProvider(value: unknown): value is LlmProvider {
  return (LLM_PROVIDERS as readonly unknown[]).includes(value);
}

/**
 * Coerces a stored (or submitted) routing to a valid one.
 *
 * Per use, not all-or-nothing: a bad model id in one row should not reset the
 * other three. But within a row it *is* all-or-nothing -- a route with a valid
 * provider and junk model gets that use's default, never a half-repaired
 * record that pairs an Anthropic provider with an OpenRouter id.
 *
 * The submitted value is data from a form, so the provider must also be one
 * the use allows: the open-weight slot stays on OpenRouter whatever the body
 * says.
 */
export function normalizeRouting(raw: unknown, defaults: LlmRouting): LlmRouting {
  const out = { ...defaults };
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  for (const use of LLM_USE_IDS) {
    const row = obj[use];
    if (!row || typeof row !== "object") continue;
    const { provider, model, fallbacks } = row as Record<string, unknown>;
    if (!isProvider(provider) || !infoFor(use).providers.includes(provider)) continue;
    if (!isValidModelId(model)) continue;
    const clean = Array.isArray(fallbacks) && takesFallbacks(provider) ? fallbacks.filter(isValidModelId) : [];
    out[use] = { provider, model, fallbacks: dedupe(clean, model) };
  }
  return out;
}

/** "a, b,c" -> ["a","b","c"]: how the form submits fallbacks. */
export function parseModelList(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The ordered list of model ids to try. Head first, never repeated. */
export function modelChainFor(route: LlmRoute): string[] {
  return [route.model, ...dedupe(route.fallbacks, route.model)];
}

/**
 * Whether every model a route may land on reads images: the Claude slot on
 * Anthropic, or on OpenRouter with Claude model ids. The open-weight slot
 * (DeepSeek) and the local model do not -- a fallback that can't see the image
 * would answer as if it hadn't been sent, so the whole chain must qualify.
 */
export function routeReadsImages(route: (LlmRoute & { use?: LlmUse }) | null): boolean {
  if (!route || route.use === "chatOpen") return false;
  // Claude Code is Claude whatever alias it runs: the runner saves the
  // images and Claude Code reads them from disk.
  if (route.provider === "claudecode") return true;
  const chain = modelChainFor(route);
  return route.provider === "anthropic" ? chain.every((m) => /claude/i.test(m)) : chain.every((m) => m.startsWith("anthropic/"));
}

export type ResolvedRoute = LlmRoute & {
  use: LlmUse;
  /**
   * True when the saved provider has no key and the request went to the other
   * one on its default model. Shown in the panel; a saved choice silently
   * answered by a different vendor is the kind of thing that gets noticed on
   * a bill and nowhere else.
   */
  substituted: boolean;
};

/**
 * The route a request actually goes out on.
 *
 * The saved provider when its key is present. Otherwise the other provider
 * the use allows, if *its* key is present -- on that provider's default chain,
 * since model ids don't carry across vendors. Null when nothing can answer.
 */
export function resolveRoute(use: LlmUse, route: LlmRoute, env: RoutingEnv): ResolvedRoute | null {
  if (env.configured[route.provider]) return { ...route, use, substituted: false };
  const other = infoFor(use).providers.find((p) => p !== route.provider && env.configured[p]);
  if (!other) return null;
  return { ...providerDefaultRoute(use, other, env), use, substituted: true };
}
