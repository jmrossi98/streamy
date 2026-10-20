import { redirect } from "next/navigation";
import { getSession, requireAdmin } from "@/lib/auth";
import { AssistantChatPanel } from "@/components/AssistantChatPanel";
import { LlmRoutingDisclosure } from "@/components/LlmRoutingDisclosure";

/**
 * The assistant as an Admin tab. Given an explicit height -- the screen less
 * the navbar, the Admin heading and the tab row -- because inside the admin
 * layout there is no parent height to fill, and a "fill the space" transcript
 * collapsed to a strip a few lines tall. The expand button goes to /assistant,
 * which drops the Admin heading and tabs for the whole screen.
 *
 * The model routing lives above the chat, folded shut: it decides which
 * vendor and model each cloud job (this chat's slots, resumes, apply packets)
 * goes to, and this is where the admin is already thinking about models.
 */
export default async function AdminChatPage() {
  // The admin layout already refused non-admins; kept as defence in depth.
  if (!(await requireAdmin(await getSession()))) {
    redirect("/");
  }
  return (
    <div className="flex h-[calc(100dvh-17rem)] min-h-[26rem] flex-col gap-2">
      <LlmRoutingDisclosure
        aside={
          <a
            href="/assistant"
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-white/50 underline-offset-2 transition-colors hover:text-white hover:underline"
          >
            Open in new window ↗
          </a>
        }
      />
      <div className="min-h-0 flex-1">
        <AssistantChatPanel />
      </div>
    </div>
  );
}
