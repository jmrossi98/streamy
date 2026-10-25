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
 *
 * On a phone it is laid out like the Claude and ChatGPT apps: no gutter, no
 * card, a one-row header (menu, chat, new) and the conversation. The routing
 * row is for wide screens; the phone reaches the admin from the chat drawer
 * and the routing from the options sheet. The bottom padding is --safe-bottom
 * (LayoutShell): the home-indicator inset, or nothing while the keyboard is
 * up, so the composer sits on the keys.
 *
 * In the home-screen app the page runs under the status bar, and the header
 * row sat 11px below the Dynamic Island's inset -- tight against it. The
 * standalone-only half-rem puts the title where a native nav bar's would be.
 * Safari is left exactly as it was: the rule never applies there.
 */
export default async function AssistantPage() {
  const session = await getSession();
  if (!session) redirect("/login?callbackUrl=/assistant");
  if (!(await requireAdmin(session))) redirect("/");
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2 pb-[var(--safe-bottom,env(safe-area-inset-bottom,0px))] pt-[env(safe-area-inset-top,0px)] [@media(display-mode:standalone)]:pt-[calc(0.5rem+env(safe-area-inset-top,0px))] md:px-4 md:pb-4 md:pt-[calc(0.5rem+env(safe-area-inset-top,0px))]">
      <LlmRoutingDisclosure
        className="hidden md:flex"
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
        <AssistantChatPanel layout="page" />
      </div>
    </div>
  );
}
