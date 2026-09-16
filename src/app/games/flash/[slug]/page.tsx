import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { unstable_noStore } from "next/cache";
import { getSession, getValidSessionUserId, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { FlashWatchlistButton } from "@/components/FlashWatchlistButton";
import { getFlashGame } from "@/lib/flashGames";
import { FlashPlayer } from "@/components/FlashPlayer";
import { FlashImportPanel } from "@/components/FlashImportPanel";
import { FlashDeleteButton } from "@/components/FlashDeleteButton";
import { BROWSE_PAGE_CLASS } from "@/lib/browseLayout";

/**
 * One Flash game: the same shape as a movie or show page, plus the thing that
 * makes it a game -- a window you can play it in.
 *
 * Signed-in viewers, not admins. Flash is the half of the Games tab meant for
 * the household; the ROM/emulator half is what stays admin-only.
 */
export const dynamic = "force-dynamic";

export default async function FlashGamePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  unstable_noStore();
  const { slug } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?callbackUrl=/games/flash/${slug}`);

  const game = await getFlashGame(slug);
  if (!game) notFound();

  const admin = await requireAdmin(session);
  const userId = await getValidSessionUserId(session);
  const inList = userId
    ? !!(await prisma.watchlistFlashGameItem.findUnique({
        where: { userId_slug: { userId, slug } },
        select: { slug: true },
      }))
    : false;

  return (
    <div className={BROWSE_PAGE_CLASS}>
      <div className="mx-auto w-full max-w-5xl px-4 md:px-6">
        <Link href="/games" className="text-sm text-white/50 transition-colors hover:text-white">
          ← Games
        </Link>

        {/* Title, byline and the list button on one line on desktop: the
            player is the point of this page, and three stacked blocks above it
            pushed it below the fold on a laptop. */}
        <div className="mb-5 mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold text-white sm:text-3xl">
              {game.title}
            </h1>
            {game.developer && (
              <p className="mt-1 truncate text-sm text-white/50">{game.developer}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <FlashWatchlistButton slug={game.slug} initialInList={inList} />
            {/* Admin-only, and only once there is something to delete. The
                game re-downloads on the next play, so this is a repair for a
                bad copy rather than a removal. */}
            {admin && game.playable && <FlashDeleteButton slug={game.slug} />}
          </div>
        </div>

        {game.isActionScript3 && (
          // Said before they play rather than after it fails. Ruffle's AS3
          // support is still incomplete, so this is a real prediction, not
          // boilerplate -- and it's why the flag is recorded at import.
          <p className="mb-4 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200/90">
            This game uses ActionScript 3, which the Flash emulator supports only
            partially. It may not run correctly.
          </p>
        )}

        {game.playable && game.fileName ? (
          <FlashPlayer
            src={`/api/flash/${encodeURIComponent(game.fileName)}`}
            title={game.title}
            slug={game.slug}
            width={game.width}
            height={game.height}
          />
        ) : (
          // Known but not downloaded. The row exists because someone
          // bookmarked it from the archive; the file arrives when asked for.
          <FlashImportPanel slug={game.slug} title={game.title} />
        )}

        {(game.description || game.tags.length > 0) && (
          <div className="mt-8 border-t border-white/10 pt-6">
            {game.description && (
              <p className="max-w-3xl text-sm leading-relaxed text-white/70">
                {game.description}
              </p>
            )}

            {game.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {game.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-white/[0.07] px-2.5 py-1 text-xs text-white/60"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
