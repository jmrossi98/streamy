import { redirect } from "next/navigation";
import { getSession, requireAdmin } from "@/lib/auth";
import { AssistantChatPanel } from "@/components/AssistantChatPanel";
import { LlmRoutingPanel } from "@/components/LlmRoutingPanel";
import { getResolvedRoutes, getRouting, modelSuggestions, providersConfigured } from "@/lib/llm";

/**
 * The assistant as an Admin tab. Given an explicit height -- the screen less
 * the navbar, the Admin heading and the tab row -- because inside the admin
 * layout there is no parent height to fill, and a "fill the space" transcript
 * collapsed to a strip a few lines tall. The expand button goes to /assistant,
 * which drops the Admin heading and tabs for the whole screen.
 *
 * The model routing lives here too, folded shut: it decides which vendor and
 * model each cloud job (this chat's slots, resumes, apply packets) goes to,
 * and this tab is where the admin is already thinking about models.
 */
export default async function AdminChatPage() {
  // The admin layout already refused non-admins; kept as defence in depth.
  if (!(await requireAdmin(await getSession()))) {
    redirect("/");
  }
  const [routing, resolved, suggestions] = await Promise.all([getRouting(), getResolvedRoutes(), modelSuggestions()]);
  return (
    <div className="flex h-[calc(100dvh-17rem)] min-h-[26rem] flex-col gap-2">
      {/* The link sits beside the disclosure, not inside its summary, so a
          click on it opens the window without also toggling the panel. */}
      <div className="flex items-start justify-between gap-3 text-xs">
        <details className="group min-w-0 flex-1">
          <summary className="inline-flex cursor-pointer list-none items-center text-white/50 hover:text-white/80">
            <span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
            Model routing
          </summary>
          <div className="mt-3 rounded-lg border border-white/10 bg-netflix-dark/80 p-4">
            <LlmRoutingPanel initial={{ routing, resolved, configured: providersConfigured(), suggestions }} />
          </div>
        </details>
        <a
          href="/assistant"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-white/50 underline-offset-2 transition-colors hover:text-white hover:underline"
        >
          Open in new window ↗
        </a>
      </div>
      <div className="min-h-0 flex-1">
        <AssistantChatPanel />
      </div>
    </div>
  );
}
