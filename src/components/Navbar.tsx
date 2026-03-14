"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { SearchModal } from "./SearchModal";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/movies", label: "Movies" },
  { href: "/tv", label: "TV Shows" },
];

export function Navbar() {
  const { data: session, status } = useSession();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const initial = session?.user?.name?.slice(0, 1).toUpperCase() ?? "?";

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? "bg-netflix-black/95 shadow-lg" : "bg-transparent"
      }`}
    >
      <nav className="flex items-center justify-between px-6 py-4 max-w-[1920px] mx-auto">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="text-netflix-red text-3xl font-bold tracking-tight">
            STREAMY
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-white/90 hover:text-white transition-colors"
            >
              {link.label}
            </Link>
          ))}
          {session && (
            <Link
              href="/watchlist"
              className="text-sm text-white/90 hover:text-white transition-colors"
            >
              My List
            </Link>
          )}
        </div>

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="p-2 text-white/90 hover:text-white transition-colors"
            aria-label="Search"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
          <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
          {status === "loading" ? (
            <span className="w-8 h-8 rounded bg-white/20 animate-pulse" />
          ) : session ? (
            <div className="relative">
              <button
                type="button"
                className="w-8 h-8 rounded bg-netflix-red flex items-center justify-center text-white text-sm font-medium hover:opacity-90 transition-opacity"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-expanded={menuOpen}
                aria-label="Account menu"
              >
                {initial}
              </button>
              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    aria-hidden
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-2 w-48 py-2 bg-netflix-dark rounded shadow-xl z-50 border border-white/10">
                    <div className="px-4 py-2 border-b border-white/10">
                      <p className="text-white text-sm truncate">{session.user?.name}</p>
                    </div>
                    <Link
                      href="/watchlist"
                      className="block px-4 py-2 text-sm text-white/90 hover:bg-white/10"
                      onClick={() => setMenuOpen(false)}
                    >
                      My List
                    </Link>
                    <button
                      type="button"
                      className="w-full text-left px-4 py-2 text-sm text-white/90 hover:bg-white/10"
                      onClick={() => { setMenuOpen(false); signOut({ callbackUrl: "/" }); }}
                    >
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className="px-4 py-2 bg-netflix-red text-white text-sm font-medium rounded hover:bg-netflix-red/90 transition-colors"
            >
              Get started
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
