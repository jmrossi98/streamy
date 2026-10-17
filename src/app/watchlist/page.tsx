import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getWatchlist } from "@/lib/watchlist";
import { WatchlistContent } from "./WatchlistContent";
import { BROWSE_PAGE_CLASS } from "@/lib/browseLayout";
import { ROW_WINDOW } from "@/lib/browseShelfRules";

export default async function WatchlistPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login?callbackUrl=/watchlist");

  // Rows show ROW_WINDOW tiles and the headings open the full shelves; twice
  // that is loaded so removing a few still leaves a full row behind them.
  const data = await getWatchlist(session.user.id, {
    splitAnime: !!session.user.isAdmin,
    rowLimit: ROW_WINDOW * 2,
  });

  return (
    <div className={BROWSE_PAGE_CLASS}>
      <h1 className="streamy-page-title-x mb-6 font-display text-4xl font-bold text-white">
        My List
      </h1>
      <WatchlistContent data={data} />
    </div>
  );
}
