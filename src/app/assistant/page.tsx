import { redirect } from "next/navigation";
import { getSession, requireAdmin } from "@/lib/auth";
import { AssistantChatPanel } from "@/components/AssistantChatPanel";
import { LlmRoutingDisclosure } from "@/components/LlmRoutingDisclosure";

export const dynamic = "force-dynamic";

/**
 * The assistant, expanded: no navbar, no Admin heading or tabs -- the chat is
 * the whole screen, with a link back to the admin area beside the routing
 * disclosure. LayoutShell treats this as a fullscreen, chrome-only route, so
 * the main is exactly the screen and h-full is the whole job. Which chat is
 * open carries over from the Admin tab, and so does the model routing.
 */
export default async function AssistantPage() {
  const session = await getSession();
  if (!session) redirect("/login?callbackUrl=/assistant");
  if (!(await requireAdmin(session))) redirect("/");
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2 px-2 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] sm:px-4 sm:pb-4">
      <LlmRoutingDisclosure
        aside={
          <a
            href="/admin/chat"
            className="flex shrink-0 items-center gap-1.5 text-white/50 underline-offset-2 transition-colors hover:text-white hover:underline"
          >
            <span aria-hidden>←</span> Back to admin
          </a>
        }
      />
      <div className="min-h-0 flex-1">
        <AssistantChatPanel />
      </div>
    </div>
  );
}
