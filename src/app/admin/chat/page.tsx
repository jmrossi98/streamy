import { redirect } from "next/navigation";
import { getSession, requireAdmin } from "@/lib/auth";
import { OpsChat } from "@/components/OpsChat";
import { getOllamaStatus, isOllamaConfigured, ollamaModel } from "@/lib/ollama";
import { isOpenRouterConfigured, openRouterModel } from "@/lib/openrouter";
import { isWebSearchConfigured } from "@/lib/webSearch";

/**
 * Full-screen chat. The Admin Features panel keeps a compact version for
 * quick questions; this is the one to use for a long conversation, where a
 * 24rem transcript box means scrolling a small window instead of reading.
 */
export default async function AdminChatPage() {
  // The admin layout already refused non-admins; kept as defence in depth, the
  // same as the other admin pages.
  if (!(await requireAdmin(await getSession()))) {
    redirect("/");
  }

  const status = isOllamaConfigured() ? await getOllamaStatus() : null;

  return (
    // A normal page in the layout flow. LayoutShell pins <main> to 100dvh for
    // this route, so h-full here fills the screen without fixed positioning --
    // which is what made this read as an overlay rather than a page.
    <div className="flex min-h-[70vh] flex-col">
      <div className="mx-auto flex w-full min-h-0 max-w-3xl flex-1 flex-col">
        {/* The tabs are the way back now, so no back-link here. */}
        <h2 className="pb-3 text-lg font-semibold text-white">Assistant</h2>

        <div className="min-h-0 flex-1 rounded-lg border border-white/10 bg-netflix-dark/80 p-4">
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
      </div>
    </div>
  );
}
