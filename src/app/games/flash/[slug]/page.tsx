import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { unstable_noStore } from "next/cache";
import { getSession } from "@/lib/auth";
import { getFlashGame } from "@/lib/flashGames";
import { FlashPlayer } from "@/components/FlashPlayer";
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
  if (!(await getSession())) redirect(`/login?callbackUrl=/games/flash/${slug}`);

  const game = await getFlashGame(slug);
  if (!game) notFound();

  return (
    <div className={BROWSE_PAGE_CLASS}>
      <div className="mx-auto w-full max-w-5xl px-4 md:px-6">
        <Link href="/games" className="text-sm text-white/50 transition-colors hover:text-white">
          ← Games
        </Link>

        <h1 className="mb-1 mt-3 font-display text-2xl font-bold text-white sm:text-3xl">
          {game.title}
        </h1>
        {game.developer && (
          <p className="mb-3 text-sm text-white/50">{game.developer}</p>
        )}

        {game.isActionScript3 && (
          // Said before they play rather than after it fails. Ruffle's AS3
          // support is still incomplete, so this is a real prediction, not
          // boilerplate -- and it's why the flag is recorded at import.
          <p className="mb-4 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200/90">
            This game uses ActionScript 3, which the Flash emulator supports only
            partially. It may not run correctly.
          </p>
        )}

        <FlashPlayer
          src={`/api/flash/${encodeURIComponent(game.fileName)}`}
          title={game.title}
          width={game.width}
          height={game.height}
        />

        {game.description && (
          <p className="mt-5 max-w-3xl text-sm leading-relaxed text-white/70">
            {game.description}
          </p>
        )}

        {game.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {game.tags.map((tag) => (
              <span key={tag} className="rounded bg-white/10 px-2 py-1 text-xs text-white/60">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
