import Link from "next/link";
import { BROWSE_PAGE_CLASS } from "@/lib/browseLayout";

type Props = {
  /** Where the back link goes, and what it is called. */
  backHref: string;
  backLabel: string;
  title: string;
  /** "60 movies", already worded. */
  countText: string;
  /** Shown instead of the grid when the shelf has nothing in it. */
  emptyText: string;
  isEmpty: boolean;
  /** The link that loads the next page, or null when there is no more. */
  moreHref: string | null;
  /** The other shelves of the same kind, for moving sideways without going back. */
  others: { href: string; label: string }[];
  children: React.ReactNode;
};

/**
 * The frame around a full shelf: where you came from, what this is, the grid,
 * a way to get more of it, and the neighbouring shelves. Laid out like the
 * Flash genre page, which is the same idea for games.
 */
export function ShelfPage({
  backHref,
  backLabel,
  title,
  countText,
  emptyText,
  isEmpty,
  moreHref,
  others,
  children,
}: Props) {
  return (
    <div className={BROWSE_PAGE_CLASS}>
      <div className="mx-auto w-full max-w-[1800px] px-4 md:px-6">
        <Link href={backHref} className="text-sm text-white/50 transition-colors hover:text-white">
          &larr; {backLabel}
        </Link>

        <div className="mt-2 mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-display text-3xl font-bold text-white sm:text-4xl">{title}</h1>
          {!isEmpty && <span className="text-sm text-white/40">{countText}</span>}
        </div>

        {isEmpty ? <p className="py-12 text-sm text-white/50">{emptyText}</p> : children}

        {moreHref && (
          <div className="mt-8 flex justify-center">
            {/* scroll={false}: the page grows underneath the viewer rather
                than jumping back to the top with twenty more titles on it. */}
            <Link
              href={moreHref}
              scroll={false}
              className="rounded border border-white/25 px-5 py-2 text-sm font-medium text-white/80 transition-colors hover:border-white/50 hover:text-white"
            >
              Load more
            </Link>
          </div>
        )}

        {others.length > 0 && (
          <nav className="mt-12 border-t border-white/10 pt-6">
            <h2 className="mb-3 text-sm font-semibold text-white/60">More to browse</h2>
            <div className="flex flex-wrap gap-2">
              {others.map((o) => (
                <Link
                  key={o.href}
                  href={o.href}
                  className="rounded-full bg-white/[0.07] px-3 py-1.5 text-sm text-white/75 transition-colors hover:bg-white/15 hover:text-white"
                >
                  {o.label}
                </Link>
              ))}
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}
