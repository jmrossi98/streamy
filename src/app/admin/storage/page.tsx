import { getDiskUsage } from "@/lib/diskUsage";
import { AdminSection } from "@/components/ui";
import { StorageChart } from "@/components/StorageChart";
import { getGamesStorageSize } from "@/lib/games";
import { AdminDownloadsSections } from "@/components/AdminDownloadsSections";
import { unstable_noStore } from "next/cache";

export default async function AdminStoragePage() {
  // The downloads panels below poll live state, so this page must not be
  // served from a cache the way a storage chart alone could be.
  unstable_noStore();
  const [diskUsage, gamesSize] = await Promise.all([
    getDiskUsage(),
    // Swallows its own errors and answers 0, so an unreachable gamarr costs
    // the games slice rather than the chart.
    getGamesStorageSize().catch(() => 0),
  ]);

  return (
      <div className="space-y-10">
      <AdminSection title="Storage usage">
        {diskUsage ? (
          <StorageChart
            totalSpace={diskUsage.totalBytes}
            freeSpace={diskUsage.freeBytes}
            moviesSize={diskUsage.categories.movies}
            tvSize={diskUsage.categories.tv}
            gamesSize={gamesSize}
          />
        ) : (
          <p className="text-white/50 text-sm">
            Storage info unavailable - mediabox isn&apos;t reachable.
          </p>
        )}
      </AdminSection>

      {/* Below the chart on purpose: the chart is the one thing worth seeing
          at a glance, and downloads are what explain it. */}
      <AdminDownloadsSections />
      </div>
  );
}
