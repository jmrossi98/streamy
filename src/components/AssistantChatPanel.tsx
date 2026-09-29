import { OpsChat } from "@/components/OpsChat";
import { getOllamaStatus, isOllamaConfigured, ollamaModel } from "@/lib/ollama";
import { isOpenRouterConfigured, openRouterModel } from "@/lib/openrouter";
import { isWebSearchConfigured } from "@/lib/webSearch";

/** The assistant, as both the Admin tab and the expanded page render it. */
export async function AssistantChatPanel() {
  const status = isOllamaConfigured() ? await getOllamaStatus() : null;
  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-white/10 bg-netflix-dark/80 p-3 sm:p-4">
      <OpsChat
        localAvailable={isOllamaConfigured()}
        remoteAvailable={isOpenRouterConfigured()}
        localModel={ollamaModel()}
        openModel={openRouterModel("open")}
        claudeModel={openRouterModel("claude")}
        statusError={status && !status.ok ? status.error : null}
        searchAvailable={isWebSearchConfigured()}
        fullHeight
      />
    </div>
  );
}
