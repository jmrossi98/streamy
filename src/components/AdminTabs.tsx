"use client";

import { usePathname } from "next/navigation";
import { TabBar, TabLink } from "@/components/ui";

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
  // First: is playback working right now, for whom, and is there room for
  // one more. Viewers moved here from Security on 2026-10-18.
  { href: "/admin/streaming", label: "Streaming" },
  { href: "/admin/security", label: "Security" },
  { href: "/admin/health", label: "Health" },
  { href: "/admin/metrics", label: "Metrics" },
  // Downloads and the storage chart share a tab: what is arriving and what it
  // is filling up are the same question from two sides. Named for the
  // downloads, which are what the tab is opened for.
  { href: "/admin/downloads", label: "Downloads" },
  // Channel management, moved here from /live on 2026-10-16: select/hide/
  // delete and the stream catalogue were sitting above the channels on the
  // viewing page. Next to Downloads because both are "what is in the
  // library" rather than "is anything wrong".
  { href: "/admin/live-tv", label: "Live TV" },
  { href: "/admin/spend", label: "Subscriptions" },
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
    <TabBar label="Admin sections" className="mt-6">
      {ADMIN_TABS.map((tab) => (
        <TabLink key={tab.href} href={tab.href} active={isActiveTab(tab.href, pathname)}>
          {tab.label}
        </TabLink>
      ))}
    </TabBar>
  );
}
