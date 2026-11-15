import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { unstable_noStore } from "next/cache";
import { getSession, requireAdmin } from "@/lib/auth";
import { getCatalogGame, isIgdbConfigured } from "@/lib/igdb";
import { gameStatuses } from "@/lib/gameGrabs";
import { systemBySlug } from "@/lib/gameSystems";
import { BROWSE_PAGE_CLASS } from "@/lib/browseLayout";
import { CatalogGameActions } from "./CatalogGameActions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/**
 * One catalog game: what it is, and a row per console it came out on that
 * Streamy can fetch for -- in the library (with a link to its page, where the
 * artwork is chosen), on its way, or a Download button. Admin only.
 */
export default async function CatalogGamePage({ params }: Props) {
  unstable_noStore();
  const session = await getSession();
  if (!session) redirect("/login?callbackUrl=/games/find");
  if (!(await requireAdmin(session))) redirect("/games");
  if (!isIgdbConfigured()) redirect("/games/find");

  const { id } = await params;
  const game = await getCatalogGame(Number(id)).catch(() => null);
  if (!game) notFound();
  const statuses = await gameStatuses(game.id, game.name, game.systems);
  const systems = game.systems.map((slug) => ({ slug, name: systemBySlug(slug)?.name ?? slug }));

  return (
    <div className={`${BROWSE_PAGE_CLASS} relative`}>
      {game.backdropUrl && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[50vh] overflow-hidden" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={game.backdropUrl} alt="" className="h-full w-full object-cover opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-b from-netflix-black/40 via-netflix-black/70 to-netflix-black" />
        </div>
      )}
      <div className="relative mx-auto w-full max-w-5xl space-y-6 px-4 md:px-6">
        <Link href="/games/find" className="text-sm text-white/50 transition-colors hover:text-white">
          ← Find a game
        </Link>
        <div className="flex flex-col gap-6 sm:flex-row">
          <div className="relative aspect-[3/4] w-40 shrink-0 overflow-hidden rounded bg-white/5 sm:w-52">
            {game.coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={game.coverUrl} alt={game.name} className="h-full w-full object-cover" />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <h1 className="font-display text-2xl font-bold text-white sm:text-3xl">{game.name}</h1>
            <p className="text-sm text-white/50">
              {[game.year, game.developer, game.genres.slice(0, 3).join(", "), game.rating != null ? `${game.rating}/100` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {game.summary && <p className="max-w-3xl text-sm leading-relaxed text-white/75">{game.summary}</p>}
            <CatalogGameActions igdbId={game.id} systems={systems} initial={statuses} />
          </div>
        </div>
      </div>
    </div>
  );
}
