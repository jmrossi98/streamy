import { getDiskUsage } from "@/lib/diskUsage";
import { StorageChart } from "@/components/StorageChart";
import { PanelBoundary } from "@/components/PanelBoundary";
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
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Storage usage</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PanelBoundary name="Storage usage">
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
          </PanelBoundary>
        </div>
      </section>

      {/* Below the chart on purpose: the chart is the one thing worth seeing
          at a glance, and downloads are what explain it. */}
      <AdminDownloadsSections />
      </div>
  );
}
