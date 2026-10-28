/**
 * Where a cloud-model call goes: the one place that reads the routing and
 * picks a provider client. Call sites ask for a *use* (resume, apply, a chat
 * slot) and get back a route; they never name a provider themselves.
 *
 * The routing lives in one JSON Setting row so the admin can move a job
 * between OpenRouter and Anthropic, or change a model id, from the panel.
 * Defaults come from env -- the same OPENROUTER_* and ANTHROPIC_* variables
 * that configure the providers -- so a fresh database behaves exactly as the
 * deploy configured it.
 */

import { prisma } from "./db";
import { cached } from "./ttlCache";
import type { ChatMessage } from "./ollama";
import type { Effort } from "./anthropicRules";
import {
  anthropicDefaultChain,
  completeAnthropic,
  isAnthropicConfigured,
  listAnthropicModels,
  streamAnthropicChat,
} from "./anthropic";
import {
  completeOpenRouter,
  isOpenRouterConfigured,
  maxOutputTokens,
  modelChain,
  streamOpenRouterChat,
} from "./openrouter";
import { completeClaudeCode, streamClaudeCodeChat } from "./claudeCodeLlm";
import { isSkillRunnerConfigured } from "./skillRunner";
import {
  CLAUDE_CODE_MODEL_SUGGESTIONS,
  DEFAULT_CLAUDE_CODE_MODEL,
  LLM_USES,
  OPENROUTER_MODEL_SUGGESTIONS,
  defaultRouting,
  providerDefaultRoute,
  modelChainFor,
  normalizeRouting,
  resetUses,
  resolveRoute,
  routeReadsImages,
  type LlmProvider,
  type LlmRoute,
  type LlmRouting,
  type LlmUse,
  type ResolvedRoute,
  type RoutingEnv,
} from "./llmRoutingRules";

export const LLM_ROUTING_KEY = "llm_routing";
const MODELS_TTL_MS = 60 * 60_000;

export function providersConfigured(): Record<LlmProvider, boolean> {
  return { openrouter: isOpenRouterConfigured(), anthropic: isAnthropicConfigured(), claudecode: isSkillRunnerConfigured() };
}

/** True when at least one metered provider has a key (Claude Code is not one). */
export function isAnyCloudConfigured(): boolean {
  const c = providersConfigured();
  return c.openrouter || c.anthropic;
}

export function routingEnv(): RoutingEnv {
  return {
    configured: providersConfigured(),
    claude: {
      openrouter: modelChain("claude"),
      anthropic: anthropicDefaultChain(),
      claudecode: [DEFAULT_CLAUDE_CODE_MODEL],
    },
    open: modelChain("open"),
  };
}

/** The saved routing over the env defaults. Fails soft to the defaults. */
export async function getRouting(): Promise<LlmRouting> {
  const defaults = defaultRouting(routingEnv());
  try {
    const row = await prisma.setting.findUnique({ where: { key: LLM_ROUTING_KEY }, select: { value: true } });
    if (!row) return defaults;
    return normalizeRouting(JSON.parse(row.value), defaults);
  } catch {
    return defaults;
  }
}

/** Validates and stores a routing; returns what was actually saved. */
export async function saveRouting(raw: unknown): Promise<LlmRouting> {
  const clean = normalizeRouting(raw, defaultRouting(routingEnv()));
  const value = JSON.stringify(clean);
  await prisma.setting.upsert({
    where: { key: LLM_ROUTING_KEY },
    create: { key: LLM_ROUTING_KEY, value },
    update: { value },
  });
  return clean;
}

/**
 * The env-default route for every use on every provider it allows -- what a
 * row becomes when the admin switches its provider, so the switch can save
 * at once instead of waiting for a model id to be typed.
 */
export function providerDefaults(): Record<LlmUse, Partial<Record<LlmProvider, LlmRoute>>> {
  const env = routingEnv();
  const out = {} as Record<LlmUse, Partial<Record<LlmProvider, LlmRoute>>>;
  for (const use of LLM_USES) {
    out[use.id] = {};
    for (const p of use.providers) out[use.id][p] = providerDefaultRoute(use.id, p, env);
  }
  return out;
}

/** Everything the routing panel shows, in one read. */
export async function routingSnapshot() {
  const [routing, resolved, suggestions] = await Promise.all([getRouting(), getResolvedRoutes(), modelSuggestions()]);
  return { routing, resolved, configured: providersConfigured(), suggestions, defaults: providerDefaults() };
}

/**
 * Back to the env defaults: every use, or only the ones given (each panel
 * resets its own rows; see llmRoutingRules.resetUses).
 */
export async function resetRouting(uses?: readonly LlmUse[]): Promise<LlmRouting> {
  if (uses) return saveRouting(resetUses(await getRouting(), uses, defaultRouting(routingEnv())));
  await prisma.setting.deleteMany({ where: { key: LLM_ROUTING_KEY } });
  return defaultRouting(routingEnv());
}

/** The route a use will actually go out on right now, or null if nothing can serve it. */
export async function getRoute(use: LlmUse): Promise<ResolvedRoute | null> {
  const routing = await getRouting();
  return resolveRoute(use, routing[use], routingEnv());
}

/** Every use resolved at once, for the panel. */
export async function getResolvedRoutes(): Promise<Record<LlmUse, ResolvedRoute | null>> {
  const routing = await getRouting();
  const env = routingEnv();
  const out = {} as Record<LlmUse, ResolvedRoute | null>;
  for (const use of Object.keys(routing) as LlmUse[]) out[use] = resolveRoute(use, routing[use], env);
  return out;
}

/**
 * Whether the route that will answer reads images. The chat route asks this
 * before it attaches any: images go out as image content blocks on a Claude
 * route (Anthropic direct, OpenRouter Claude) and nowhere else. A null route
 * is the local model, which never gets them.
 */
export function canReadImages(route: ResolvedRoute | null): boolean {
  return routeReadsImages(route);
}

/**
 * Streams a reply as NDJSON in Ollama's shape, whichever provider answers.
 * The panel's reader is the same for all of them.
 */
export function streamChat(
  route: ResolvedRoute,
  messages: ChatMessage[],
  signal?: AbortSignal,
  opts: { chatId?: string | null } = {}
): Promise<ReadableStream<Uint8Array>> {
  if (route.provider === "claudecode") return streamClaudeCodeChat(messages, route.model, signal, opts.chatId ?? null);
  const models = modelChainFor(route);
  return route.provider === "anthropic"
    ? streamAnthropicChat(messages, models, signal, { maxTokens: maxOutputTokens() })
    : streamOpenRouterChat(messages, models, signal);
}

/** One buffered completion on the route's chain. */
export function complete(
  route: ResolvedRoute,
  messages: ChatMessage[],
  opts: { maxTokens: number; webSearch?: boolean; timeoutMs?: number; effort?: Effort }
): Promise<{ text: string; model: string }> {
  if (route.provider === "claudecode") return completeClaudeCode(messages, route.model, opts.timeoutMs);
  const models = modelChainFor(route);
  return route.provider === "anthropic"
    ? completeAnthropic(messages, { ...opts, models })
    : completeOpenRouter(messages, { models, maxTokens: opts.maxTokens, webSearch: opts.webSearch, timeoutMs: opts.timeoutMs });
}

/**
 * Model ids to suggest per provider. OpenRouter's catalogue is public and
 * needs no key; Anthropic's needs the key and is empty without one.
 */
export async function modelSuggestions(): Promise<Record<LlmProvider, string[]>> {
  const [anthropic, openrouter] = await Promise.all([listAnthropicModels(), listOpenRouterModels()]);
  return { anthropic, openrouter, claudecode: [...CLAUDE_CODE_MODEL_SUGGESTIONS] };
}

function listOpenRouterModels(): Promise<string[]> {
  return cached("openrouter:models", MODELS_TTL_MS, async () => {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      if (!res.ok) return [...OPENROUTER_MODEL_SUGGESTIONS];
      const body = (await res.json()) as { data?: { id?: string }[] };
      const ids = (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
      return ids.length > 0 ? ids.sort() : [...OPENROUTER_MODEL_SUGGESTIONS];
    } catch {
      return [...OPENROUTER_MODEL_SUGGESTIONS];
    }
  });
}
