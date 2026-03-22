import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getWatchlist } from "@/lib/watchlist";
import { WatchlistContent } from "./WatchlistContent";
import { BROWSE_PAGE_CLASS } from "@/lib/browseLayout";

export default async function WatchlistPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/who-is-watching?callbackUrl=/watchlist");

  const data = await getWatchlist(session.user.id);

  return (
    <div className={BROWSE_PAGE_CLASS}>
      <h1 className="streamy-page-title-x mb-6 font-display text-4xl font-bold text-white">
        My List
      </h1>
      <WatchlistContent data={data} />
    </div>
  );
}
