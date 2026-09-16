import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCategory, listCategories } from "@/lib/flashCatalog";
import { BROWSE_PAGE_CLASS } from "@/lib/browseLayout";
import { GenreGrid } from "./GenreGrid";

/**
 * Every game in one genre.
 *
 * The shelf on /games is the first two dozen of a category that can hold
 * several hundred; this is the rest of it. Reads the generated catalogue, so
 * it costs no archive requests to render -- which is what makes paging through
 * hundreds of entries reasonable at all.
 */
export const dynamic = "force-dynamic";

export default async function FlashGenrePage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const session = await getSession();
  const { key } = await params;
  if (!session) redirect(`/login?callbackUrl=/games/flash/genre/${key}`);

  const category = getCategory(key);
  if (!category) notFound();

  // Which of these are already local, so the grid can mark them. One query for
  // the whole category rather than one per card.
  const ids = category.games.map((g) => g.id);
  const ownedRows = await prisma.flashGame.findMany({
    where: { flashpointId: { in: ids } },
    select: { flashpointId: true },
  });
  const owned = ownedRows
    .map((r) => r.flashpointId)
    .filter((id): id is string => !!id);

  const others = listCategories().filter((c) => c.key !== category.key);

  return (
    <div className={BROWSE_PAGE_CLASS}>
      <div className="mx-auto w-full max-w-7xl px-4 md:px-6">
        <Link
          href="/games"
          className="text-sm text-white/50 transition-colors hover:text-white"
        >
          &larr; Games
        </Link>

        <div className="mt-2 mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-display text-3xl font-bold text-white sm:text-4xl">
            {category.title}
          </h1>
          <span className="text-sm text-white/40">
            {category.games.length.toLocaleString()} games
          </span>
        </div>

        <GenreGrid games={category.games} ownedFlashpointIds={owned} />

        <nav className="mt-12 border-t border-white/10 pt-6">
          <h2 className="mb-3 text-sm font-semibold text-white/60">Other genres</h2>
          <div className="flex flex-wrap gap-2">
            {others.map((c) => (
              <Link
                key={c.key}
                href={`/games/flash/genre/${c.key}`}
                className="rounded-full bg-white/[0.07] px-3 py-1.5 text-sm text-white/75 transition-colors hover:bg-white/15 hover:text-white"
              >
                {c.title}
                <span className="ml-1.5 text-xs text-white/35">{c.games.length}</span>
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}
