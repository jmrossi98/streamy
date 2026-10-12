import { Suspense } from "react";
import { unstable_noStore } from "next/cache";
import { getDiskUsage } from "@/lib/diskUsage";
import { AdminSection } from "@/components/ui";
import { StorageChart } from "@/components/StorageChart";
import { getGamesStorageSize } from "@/lib/games";
import { AdminDownloadsSections } from "@/components/AdminDownloadsSections";
import { PanelWaiting } from "@/components/PanelWaiting";

/**
 * What is arriving, and what it is filling up.
 *
 * Each block streams in when its own data is ready. The page used to wait for
 * all of it -- the disk report, gamarr, and every download queue -- before
 * showing anything, so the tab sat on the admin spinner for as long as the
 * slowest of them took.
 */
export default function AdminDownloadsPage() {
  // The downloads panels poll live state, so this page must not be served
  // from a cache the way a storage chart alone could be.
  unstable_noStore();

  return (
    <div className="space-y-10">
      <AdminSection title="Storage usage">
        <Suspense fallback={<PanelWaiting label="Reading disk usage…" />}>
          <StorageUsage />
        </Suspense>
      </AdminSection>

      {/* Below the chart on purpose: the chart is the one thing worth seeing
          at a glance, and downloads are what explain it. */}
      <Suspense fallback={<PanelWaiting label="Reading downloads…" />}>
        <AdminDownloadsSections />
      </Suspense>
    </div>
  );
}

async function StorageUsage() {
  const [diskUsage, gamesSize] = await Promise.all([
    getDiskUsage(),
    // Swallows its own errors and answers 0, so an unreachable gamarr costs
    // the games slice rather than the chart.
    getGamesStorageSize().catch(() => 0),
  ]);
  if (!diskUsage) {
    return <p className="text-white/50 text-sm">Storage info unavailable - mediabox isn&apos;t reachable.</p>;
  }
  return (
    <StorageChart
      totalSpace={diskUsage.totalBytes}
      freeSpace={diskUsage.freeBytes}
      moviesSize={diskUsage.categories.movies}
      tvSize={diskUsage.categories.tv}
      gamesSize={gamesSize}
    />
  );
}
