import { OpsChat } from "@/components/OpsChat";
import { getOllamaStatus, isOllamaConfigured, ollamaModel } from "@/lib/ollama";
import { getResolvedRoutes } from "@/lib/llm";
import { cloudSlots, type ChatSlots } from "@/lib/chatSlots";
import { isWebSearchConfigured } from "@/lib/webSearch";

/** The assistant, as both the Admin tab and the expanded page render it. */
export async function AssistantChatPanel() {
  const [status, routes] = await Promise.all([
    isOllamaConfigured() ? getOllamaStatus() : null,
    getResolvedRoutes(),
  ]);
  // What each picker button will actually send to, so the panel can show the
  // model and vendor beside the slot name -- and grey a slot out when nothing
  // can answer it, with the variable that would fix that. The cloud slots are
  // rebuilt in the browser whenever the routing panel saves.
  const slots: ChatSlots = {
    local: {
      available: isOllamaConfigured(),
      model: ollamaModel(),
      provider: null,
      unavailableHint: "OLLAMA_URL is unset on the server.",
    },
    ...cloudSlots(routes),
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
