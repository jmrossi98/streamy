import { AdminSection } from "@/components/ui";
import { StreamingLivePanel } from "@/components/StreamingLivePanel";
import { StreamingHistoryPanel } from "@/components/StreamingHistoryPanel";
import { ViewerActivityPanel } from "@/components/ViewerActivityPanel";
import { AdminLiveTvManage } from "@/components/AdminLiveTvManage";

/**
 * Is playback working, for whom, and is there room for one more -- then the Live
 * TV lineup itself.
 *
 * The Viewers panel lived on Security until 2026-10-18; the Live TV tab was
 * folded in at the bottom on the same day. The result is one page for the whole
 * of streaming: the live state and headroom first (client panels that poll),
 * then channel management (a server section, so it renders with the page).
 */
export const dynamic = "force-dynamic";

export default function AdminStreamingPage() {
  return (
    <div className="space-y-10">
      <AdminSection title="Streaming now">
        <StreamingLivePanel />
      </AdminSection>

      <AdminSection title="Viewers">
        <ViewerActivityPanel />
      </AdminSection>

      <AdminSection title="History">
        <StreamingHistoryPanel />
      </AdminSection>

      {/* The Live TV tab's contents, moved here 2026-10-18 so streaming lives on
          one page. Its own async server component. */}
      <AdminLiveTvManage />
    </div>
  );
}
