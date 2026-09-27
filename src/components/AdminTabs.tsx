"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The admin sections, in one place.
 *
 * Exported because the navbar's account dropdown lists the same tabs, and two
 * copies of this list would drift the moment a section is added.
 *
 * Order is by how often each is opened rather than by when it was built:
 * the dashboard answers "is anything wrong", then the day-to-day tools, with
 * the assistant last since it is the one that answers questions about
 * everything else rather than reporting its own thing.
 */
export const ADMIN_TABS = [
  { href: "/admin/security", label: "Security" },
  { href: "/admin/health", label: "Health" },
  { href: "/admin/metrics", label: "Metrics" },
  // Downloads live under Storage: what is arriving and what it is filling up
  // are the same question from two sides, and separate tabs meant opening one
  // to make sense of the other.
  { href: "/admin/storage", label: "Storage" },
  { href: "/admin/spend", label: "Spend" },
  { href: "/admin/approvals", label: "Accounts" },
  { href: "/admin/jobs", label: "Job search" },
  { href: "/admin/tour-watch", label: "Tour watch" },
  { href: "/admin/blog", label: "Blog writer" },
  { href: "/admin/chat", label: "Assistant" },
] as const;

/**
 * Prefix match. /admin itself only redirects, so there is no bare-/admin tab to
 * keep from matching everything.
 */
export function isActiveTab(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminTabs() {
  const pathname = usePathname();

  return (
    // Scrolls rather than wraps: seven tabs do not fit a phone, and a wrapped
    // second row pushes the page content down on every admin screen.
    <nav className="mt-6 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-white/10 pb-px">
        {ADMIN_TABS.map((tab) => {
          const active = isActiveTab(tab.href, pathname);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                className={`block whitespace-nowrap rounded-t px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "border-b-2 border-netflix-red text-white"
                    : "border-b-2 border-transparent text-white/50 hover:text-white/80"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
