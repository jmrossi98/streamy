import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getWatchlistPage } from "@/lib/watchlist";
import { WatchlistContent } from "./WatchlistContent";

const INITIAL_PAGE_SIZE = 6;

export default async function WatchlistPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/who-is-watching?callbackUrl=/watchlist");

  const initial = await getWatchlistPage(session.user.id, 1, INITIAL_PAGE_SIZE);

  return (
    <div className="pt-24 pb-12 px-6">
      <h1 className="font-display text-4xl font-bold text-white mb-6">My List</h1>
      <WatchlistContent initial={initial} />
    </div>
  );
}
