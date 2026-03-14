"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "#series", label: "TV Shows" },
  { href: "#movies", label: "Movies" },
  { href: "#latest", label: "New & Popular" },
  { href: "#list", label: "My List" },
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
        </div>

        <div className="flex items-center gap-4">
          <button
            type="button"
            className="p-2 text-white/90 hover:text-white transition-colors"
            aria-label="Search"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
          <button
            type="button"
            className="p-2 text-white/90 hover:text-white transition-colors"
            aria-label="Notifications"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </button>
          <div className="relative">
            <button
              type="button"
              className="w-8 h-8 rounded bg-netflix-red flex items-center justify-center text-white text-sm font-medium hover:opacity-90 transition-opacity"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-expanded={menuOpen}
              aria-label="Account menu"
            >
              J
            </button>
            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  aria-hidden
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-48 py-2 bg-netflix-dark rounded shadow-xl z-50 border border-white/10">
                  <Link
                    href="/profile"
                    className="block px-4 py-2 text-sm text-white/90 hover:bg-white/10"
                    onClick={() => setMenuOpen(false)}
                  >
                    Account
                  </Link>
                  <Link
                    href="/help"
                    className="block px-4 py-2 text-sm text-white/90 hover:bg-white/10"
                    onClick={() => setMenuOpen(false)}
                  >
                    Help Center
                  </Link>
                  <button
                    type="button"
                    className="w-full text-left px-4 py-2 text-sm text-white/90 hover:bg-white/10"
                    onClick={() => setMenuOpen(false)}
                  >
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </nav>
    </header>
  );
}
