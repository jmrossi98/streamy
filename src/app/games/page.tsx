import { redirect } from "next/navigation";
import { unstable_noStore } from "next/cache";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGamesList } from "@/lib/games";
import { getGamePlatforms, isGamarrConfigured } from "@/lib/gamarr";
import { GamesContent } from "./GamesContent";
import { BROWSE_PAGE_CLASS } from "@/lib/browseLayout";

export const dynamic = "force-dynamic";

export default async function GamesPage() {
  unstable_noStore();
  const session = await getSession();
  const admin = await requireAdmin(session);
  // Admin-only, not just admin-hidden: a non-admin hitting this URL directly
  // (it's not in their nav, but URLs are guessable) gets redirected exactly
  // like /admin does, not shown an empty or broken page.
  if (!admin) redirect("/");

  const [items, platforms, watchlistRows] = await Promise.all([
    getGamesList(),
    getGamePlatforms(),
    prisma.watchlistGameItem.findMany({
      where: { userId: admin.id },
      select: { gameKey: true },
    }),
  ]);

  const watchlistKeys = new Set(watchlistRows.map((r) => r.gameKey));

  return (
    <div className={BROWSE_PAGE_CLASS}>
      <h1 className="streamy-page-title-x mb-6 font-display text-4xl font-bold text-white">
        Games
      </h1>
      <GamesContent
        configured={isGamarrConfigured()}
        items={items}
        platforms={platforms}
        watchlistKeys={Array.from(watchlistKeys)}
      />
    </div>
  );
}
