import { OpsChat, type ChatSlots } from "@/components/OpsChat";
import { getOllamaStatus, isOllamaConfigured, ollamaModel } from "@/lib/ollama";
import { getResolvedRoutes } from "@/lib/llm";
import { PROVIDER_LABELS } from "@/lib/llmRoutingRules";
import { isWebSearchConfigured } from "@/lib/webSearch";

/** The assistant, as both the Admin tab and the expanded page render it. */
export async function AssistantChatPanel() {
  const [status, routes] = await Promise.all([
    isOllamaConfigured() ? getOllamaStatus() : null,
    getResolvedRoutes(),
  ]);
  // What each picker button will actually send to, so the panel can show the
  // model and vendor beside the slot name -- and grey a slot out when nothing
  // can answer it, with the variable that would fix that.
  const slots: ChatSlots = {
    local: {
      available: isOllamaConfigured(),
      model: ollamaModel(),
      provider: null,
      unavailableHint: "OLLAMA_URL is unset on the server.",
    },
    open: {
      available: routes.chatOpen !== null,
      model: routes.chatOpen?.model ?? "",
      provider: routes.chatOpen ? PROVIDER_LABELS[routes.chatOpen.provider] : null,
      unavailableHint: "OPENROUTER_API_KEY is unset on the server.",
    },
    claude: {
      available: routes.chatClaude !== null,
      model: routes.chatClaude?.model ?? "",
      provider: routes.chatClaude ? PROVIDER_LABELS[routes.chatClaude.provider] : null,
      unavailableHint: "Neither ANTHROPIC_API_KEY nor OPENROUTER_API_KEY is set on the server.",
    },
  };
  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-white/10 bg-netflix-dark/80 p-3 sm:p-4">
      <OpsChat
        slots={slots}
        statusError={status && !status.ok ? status.error : null}
        searchAvailable={isWebSearchConfigured()}
        fullHeight
      />
    </div>
  );
}
