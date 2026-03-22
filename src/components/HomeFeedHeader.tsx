"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const CHIPS = [
  { href: "/", label: "For You" },
  { href: "/movies", label: "Movies" },
  { href: "/tv", label: "TV Shows" },
  { href: "/watchlist", label: "My List" },
] as const;

export function HomeFeedHeader() {
  const pathname = usePathname();

  return (
    <div className="mb-4 px-4 md:hidden">
      <h1 className="font-display text-2xl font-bold tracking-tight text-white md:text-3xl">For You</h1>
      <div
        className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1 pt-0.5 [-webkit-overflow-scrolling:touch]"
        role="navigation"
        aria-label="Browse categories"
      >
        {CHIPS.map(({ href, label }) => {
          const active =
            href === "/"
              ? pathname === "/" || pathname === ""
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors touch-manipulation ${
                active
                  ? "border-white bg-white text-netflix-black shadow-lg shadow-black/20"
                  : "border-white/25 bg-white/5 text-white/90 backdrop-blur-sm hover:border-white/40 hover:bg-white/10"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
