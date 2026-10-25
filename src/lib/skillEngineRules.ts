/**
 * Which agent engine runs mediabox skills, and on what model. Pure.
 *
 * 2026-10-25: the skill runner (mediabox-infra) gained a second engine.
 * `claude` is Claude Code on Jake's subscription, the default while his
 * Anthropic credit lasts. `opencode` is OpenCode, which can run the same
 * skill on Anthropic by API key, on OpenRouter, or on mediabox's own Ollama
 * -- the path for when the credit is spent or the plan lapses -- and which
 * asks about a command the permission profile doesn't name instead of
 * refusing it (the ask becomes a card in the chat; see skillRunnerRules).
 *
 * The choice is one admin setting, saved from the assistant's routing panel,
 * and sent with every run the admin starts. The runner validates it again.
 */

export type SkillEngine = "claude" | "opencode";

export const SKILL_ENGINES: readonly SkillEngine[] = ["claude", "opencode"];

export const ENGINE_LABELS: Record<SkillEngine, string> = {
  claude: "Claude Code",
  opencode: "OpenCode",
};

export type OpenCodeProvider = "anthropic" | "openrouter" | "ollama";

export const OPENCODE_PROVIDERS: readonly OpenCodeProvider[] = ["anthropic", "openrouter", "ollama"];

export const OPENCODE_PROVIDER_LABELS: Record<OpenCodeProvider, string> = {
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  ollama: "Ollama on mediabox",
};

/** The variable mediabox's .env needs for each provider (Ollama needs none). */
export const OPENCODE_PROVIDER_ENV: Record<OpenCodeProvider, string | null> = {
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  ollama: null,
};

export type SkillEngineChoice = { engine: SkillEngine; model: string };

export const DEFAULT_OPENCODE_MODEL = "anthropic/claude-sonnet-5-5";

export const DEFAULT_SKILL_ENGINE: SkillEngineChoice = { engine: "claude", model: DEFAULT_OPENCODE_MODEL };

/**
 * Model ids the form suggests. Free text otherwise: the point of a runtime
 * choice is reaching a model this build never heard of. The Ollama one is
 * what mediabox serves today; a 4B model on a 4 GB card is chat-grade, not
 * agent-grade, so it is last.
 */
export const OPENCODE_MODEL_SUGGESTIONS: readonly string[] = [
  "anthropic/claude-sonnet-5-5",
  "anthropic/claude-opus-5-5",
  "anthropic/claude-haiku-5-5",
  "openrouter/anthropic/claude-sonnet-5-5",
  "openrouter/deepseek/deepseek-v3.2",
  "openrouter/qwen/qwen3-coder",
  "ollama/qwen3:4b-instruct-2507-q4_K_M",
];

/** Same shape the runner accepts: provider/model-id, the id from the provider's own catalogue. */
const MODEL_RE = /^(anthropic|openrouter|ollama)\/[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;

export function isOpenCodeModel(v: unknown): v is string {
  return typeof v === "string" && MODEL_RE.test(v);
}

export function providerOf(model: string): OpenCodeProvider | null {
  const m = MODEL_RE.exec(model);
  return m ? (m[1] as OpenCodeProvider) : null;
}

export function isSkillEngine(v: unknown): v is SkillEngine {
  return typeof v === "string" && (SKILL_ENGINES as readonly string[]).includes(v);
}

/** A saved or submitted choice, coerced: junk falls back to the defaults, never to a surprise engine. */
export function normalizeSkillEngine(raw: unknown): SkillEngineChoice {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const engine = isSkillEngine(r.engine) ? r.engine : DEFAULT_SKILL_ENGINE.engine;
  const model = isOpenCodeModel(r.model) ? r.model.trim() : DEFAULT_OPENCODE_MODEL;
  return { engine, model };
}

/** What the runner's GET /engines says each engine can do right now. */
export type EnginesStatus = {
  default: SkillEngine;
  claude: { ready: boolean };
  opencode: { ready: boolean; defaultModel: string; providers: Record<OpenCodeProvider, boolean> };
};

export function normalizeEngines(raw: unknown): EnginesStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const claude = (r.claude ?? {}) as Record<string, unknown>;
  const oc = (r.opencode ?? {}) as Record<string, unknown>;
  const providers = (oc.providers ?? {}) as Record<string, unknown>;
  return {
    default: isSkillEngine(r.default) ? r.default : "claude",
    claude: { ready: claude.ready === true },
    opencode: {
      ready: oc.ready === true,
      defaultModel: isOpenCodeModel(oc.defaultModel) ? oc.defaultModel : DEFAULT_OPENCODE_MODEL,
      providers: {
        anthropic: providers.anthropic === true,
        openrouter: providers.openrouter === true,
        ollama: providers.ollama !== false,
      },
    },
  };
}

/**
 * Why the chosen engine cannot run right now, as a sentence for the panel
 * and the cards, or null when it can. Unknown status (runner unreachable)
 * is not a problem with the choice, so it is null too.
 */
export function engineProblem(choice: SkillEngineChoice, status: EnginesStatus | null): string | null {
  if (!status) return null;
  if (choice.engine === "claude") {
    return status.claude.ready ? null : "Claude Code isn't logged in on mediabox (run `claude setup-token` there).";
  }
  if (!status.opencode.ready) return "OpenCode isn't installed on mediabox.";
  const provider = providerOf(choice.model);
  if (!provider) return "That model id isn't one the runner accepts.";
  if (!status.opencode.providers[provider]) {
    const env = OPENCODE_PROVIDER_ENV[provider];
    return `${env ?? "A key"} is unset in mediabox's .env, so ${OPENCODE_PROVIDER_LABELS[provider]} can't be used yet.`;
  }
  return null;
}

/** "Claude Code" or "OpenCode · anthropic/claude-sonnet-5-5": how a run names what ran it. */
export function engineText(engine: SkillEngine | null | undefined, model?: string | null): string {
  if (!engine) return "";
  return engine === "opencode" && model ? `OpenCode · ${model}` : ENGINE_LABELS[engine];
}
