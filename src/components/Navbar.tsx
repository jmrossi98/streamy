"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { SearchModal } from "./SearchModal";
import { avatarColorOrFallback } from "@/lib/userAvatarColors";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/movies", label: "Movies" },
  { href: "/tv", label: "TV Shows" },
  { href: "/watchlist", label: "My List", authOnly: true },
];

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [hamburgerOpen, setHamburgerOpen] = useState(false);

  const isSignInScreen =
    pathname === "/login" || pathname === "/who-is-watching";

  const goHome = () => {
    if (session) {
      router.push("/");
    }
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const initial = session?.user?.name?.slice(0, 1).toUpperCase() ?? "?";
  const profileBg = avatarColorOrFallback(session?.user?.avatarColor);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 pt-[env(safe-area-inset-top)] ${
        scrolled ? "bg-netflix-black/95 shadow-lg" : "bg-transparent"
      }`}
    >
      <nav className="flex h-16 min-h-[4rem] items-center justify-between px-4 sm:px-6 max-w-[1920px] mx-auto">
        {session ? (
          <button
            type="button"
            onClick={goHome}
            className="flex items-center gap-2 shrink-0 text-left bg-transparent border-0 p-0 cursor-pointer"
            aria-label="Home"
          >
            <span className="text-netflix-red text-xl sm:text-2xl md:text-3xl font-bold tracking-tight">
              STREAMY
            </span>
          </button>
        ) : (
          <Link
            href="/who-is-watching"
            className="flex items-center gap-2 shrink-0"
            aria-label={isSignInScreen ? "Back to Who is watching" : "Home"}
          >
            <span className="text-netflix-red text-xl sm:text-2xl md:text-3xl font-bold tracking-tight">
              STREAMY
            </span>
          </Link>
        )}

        {!isSignInScreen && session && (
          <>
            <div className="hidden md:flex items-center gap-6">
              {navLinks.map((link) => {
                if ("authOnly" in link && link.authOnly && !session) return null;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="text-sm text-white/90 hover:text-white transition-colors"
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>

            <div className="flex items-center gap-1 sm:gap-4">
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="min-w-[44px] min-h-[44px] p-2 flex items-center justify-center text-white/90 hover:text-white active:text-white transition-colors touch-manipulation"
                aria-label="Search"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>

              {/* Mobile: hamburger menu (tabs + account) */}
              <div className="flex md:hidden items-center">
                <button
                  type="button"
                  onClick={() => setHamburgerOpen(!hamburgerOpen)}
                  className="min-w-[44px] min-h-[44px] p-2 flex items-center justify-center text-white/90 hover:text-white active:text-white transition-colors touch-manipulation"
                  aria-expanded={hamburgerOpen}
                  aria-label="Menu"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
                {hamburgerOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40 bg-black/60"
                      aria-hidden
                      onClick={() => setHamburgerOpen(false)}
                    />
                    <div className="fixed right-0 top-[calc(4rem+env(safe-area-inset-top,0px))] bottom-0 z-50 w-72 max-w-[85vw] bg-netflix-dark border-l border-white/10 shadow-xl flex flex-col">
                      <div className="p-4 border-b border-white/10">
                        <p className="text-white/70 text-xs uppercase tracking-wider">Signed in as</p>
                        <p className="text-white font-medium truncate mt-0.5">{session.user?.name}</p>
                      </div>
                      <nav className="flex-1 overflow-y-auto py-4">
                        {navLinks.map((link) => {
                          if ("authOnly" in link && link.authOnly) return null;
                          return (
                            <Link
                              key={link.href}
                              href={link.href}
                              onClick={() => setHamburgerOpen(false)}
                              className={`block px-4 py-3 text-base font-medium transition-colors ${
                                pathname === link.href ? "text-white bg-white/10" : "text-white/90 hover:bg-white/10 hover:text-white"
                              }`}
                            >
                              {link.label}
                            </Link>
                          );
                        })}
                        <Link
                          href="/watchlist"
                          onClick={() => setHamburgerOpen(false)}
                          className={`block px-4 py-3 text-base font-medium transition-colors ${
                            pathname === "/watchlist" ? "text-white bg-white/10" : "text-white/90 hover:bg-white/10 hover:text-white"
                          }`}
                        >
                          My List
                        </Link>
                      </nav>
                      <div className="p-4 border-t border-white/10">
                        <button
                          type="button"
                          onClick={() => { setHamburgerOpen(false); signOut({ callbackUrl: "/who-is-watching" }); }}
                          className="w-full py-3 rounded bg-white/10 text-white text-sm font-medium hover:bg-white/20 active:bg-white/25 transition-colors touch-manipulation"
                        >
                          Sign out
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Desktop: profile dropdown only (only rendered when session exists, so status is authenticated) */}
              <div className="relative hidden md:block">
                  <button
                    type="button"
                    style={{ backgroundColor: profileBg }}
                    className="w-7 h-7 rounded flex items-center justify-center text-white text-sm font-medium hover:opacity-90 active:opacity-90 transition-opacity touch-manipulation"
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
                          onClick={() => { setMenuOpen(false); signOut({ callbackUrl: "/who-is-watching" }); }}
                        >
                          Sign out
                        </button>
                      </div>
                    </>
                  )}
                </div>
            </div>
          </>
        )}
      </nav>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}
