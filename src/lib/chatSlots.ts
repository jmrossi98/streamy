/**
 * What each chat picker button sends to, built from the resolved model
 * routing. Pure and client-safe: the server builds the first copy, and the
 * routing panel rebuilds it in the browser after every save so the chat
 * switches model without a reload.
 */

import type { ChatBackendId } from "./chatModels";
import { PROVIDER_LABELS, type LlmUse, type ResolvedRoute } from "./llmRoutingRules";

export type ChatSlot = {
  /** Something can answer this slot right now. */
  available: boolean;
  /** Upstream model id, shown so it's never ambiguous who answered. */
  model: string;
  /** The vendor it goes to, for the metered slots; null for the local card. */
  provider: string | null;
  /** Why it is greyed out, naming the server variable that would fix it. */
  unavailableHint: string;
};

export type ChatSlots = Record<ChatBackendId, ChatSlot>;

/** Fired on window by the routing panel after a save; detail is the resolved routes. */
export const LLM_ROUTING_EVENT = "streamy:llm-routing";

export type ResolvedRoutes = Record<LlmUse, ResolvedRoute | null>;

function cloudSlot(route: ResolvedRoute | null, unavailableHint: string): ChatSlot {
  return {
    available: route !== null,
    model: route?.model ?? "",
    provider: route ? PROVIDER_LABELS[route.provider] : null,
    unavailableHint,
  };
}

/** The two metered slots, from the routing as it stands. */
export function cloudSlots(routes: ResolvedRoutes): Pick<ChatSlots, "open" | "claude"> {
  return {
    open: cloudSlot(routes.chatOpen, "OPENROUTER_API_KEY is unset on the server."),
    claude: cloudSlot(routes.chatClaude, "Neither ANTHROPIC_API_KEY nor OPENROUTER_API_KEY is set on the server."),
  };
}
