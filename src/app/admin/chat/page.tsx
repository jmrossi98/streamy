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
    // h-full, not a viewport calculation. LayoutShell gives this route a main
    // that is exactly the screen minus the navbar, so filling it is the whole
    // job -- and any calc here is a second guess at a height the shell already
    // knows. The previous one guessed with 100vh, which on mobile is taller
    // than the visible area, so the bottom of this box (the input) sat under
    // the browser toolbar.
    //
    // No min-height either: a 32rem floor is taller than a small phone's
    // remaining space, and the overflow went straight to the input again.
    <div className="flex h-full min-h-0 flex-col p-4 sm:p-6">
      <div className="flex w-full min-h-0 flex-1 flex-col">
        {/* No heading: the active tab already says Assistant, and repeating
            it just pushed the transcript further down. */}

        <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-white/10 bg-netflix-dark/80 p-3 sm:p-4">
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
