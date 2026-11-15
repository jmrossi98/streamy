import { redirect } from "next/navigation";
import Link from "next/link";
import { unstable_noStore } from "next/cache";
import { getSession, requireAdmin } from "@/lib/auth";
import { isIgdbConfigured, searchCatalog, type CatalogGame } from "@/lib/igdb";
import { systemBySlug } from "@/lib/gameSystems";
import { BROWSE_PAGE_CLASS } from "@/lib/browseLayout";
import { Button, Notice } from "@/components/ui";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string }> };

/**
 * The game catalog (IGDB), searched the way Movies and TV search TMDB: covers
 * first, each opening a page to download it for a console. Admin only, like
 * the rest of the ROM half of Games.
 */
export default async function FindGamePage({ searchParams }: Props) {
  unstable_noStore();
  const session = await getSession();
  if (!session) redirect("/login?callbackUrl=/games/find");
  if (!(await requireAdmin(session))) redirect("/games");

  const { q = "" } = await searchParams;
  const query = q.trim();
  let results: CatalogGame[] = [];
  let error: string | null = null;
  if (!isIgdbConfigured()) {
    error = "The game catalog isn't set up yet: Streamy needs IGDB_CLIENT_ID and IGDB_CLIENT_SECRET (a Twitch developer app).";
  } else if (query) {
    try {
      results = await searchCatalog(query);
    } catch (err) {
      console.error(`[games] catalog search failed for "${query}":`, err);
      error = "The game catalog didn't answer. Try again in a moment.";
    }
  }

  return (
    <div className={BROWSE_PAGE_CLASS}>
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 md:px-6">
        <Link href="/games" className="text-sm text-white/50 transition-colors hover:text-white">
          ← Games
        </Link>
        <h1 className="font-display text-2xl font-bold text-white sm:text-3xl">Find a game</h1>
        <form action="/games/find" method="get" className="flex max-w-xl gap-2">
          <input
            name="q"
            defaultValue={query}
            autoFocus
            placeholder="Search every console…"
            className="w-full rounded border border-white/15 bg-black/40 px-3 py-2 text-base text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none sm:text-sm"
          />
          <Button type="submit" variant="primary">
            Search
          </Button>
        </form>
        {error && <Notice tone="warning">{error}</Notice>}
        {query && !error && results.length === 0 && (
          <p className="text-sm text-white/50">Nothing in the catalog for &ldquo;{query}&rdquo; on a console Streamy can fetch for.</p>
        )}
        {results.length > 0 && (
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7">
            {results.map((g) => (
              <li key={g.id}>
                <Link href={`/games/find/${g.id}`} className="group block">
                  <div className="relative aspect-[3/4] w-full overflow-hidden rounded bg-white/5">
                    {g.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.coverUrl} alt={g.name} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                    ) : (
                      <div className="flex h-full items-center justify-center p-2 text-center text-xs text-white/40">{g.name}</div>
                    )}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-xs font-medium text-white/85">{g.name}</p>
                  <p className="truncate text-[11px] text-white/40">
                    {[g.year, g.systems.map((s) => systemBySlug(s)?.name ?? s).join(", ")].filter(Boolean).join(" · ")}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
