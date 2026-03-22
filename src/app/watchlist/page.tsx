import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getWatchlist } from "@/lib/watchlist";
import { WatchlistContent } from "./WatchlistContent";

export default async function WatchlistPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/who-is-watching?callbackUrl=/watchlist");

  const data = await getWatchlist(session.user.id);

  return (
    <div className="pt-24 pb-12 max-md:px-0 md:px-6">
      <h1 className="px-4 font-display text-4xl font-bold text-white mb-6 md:px-0">My List</h1>
      <WatchlistContent data={data} />
    </div>
  );
}
