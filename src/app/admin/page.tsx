import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getRadarrStorageInfo, getRadarrActiveDownloads } from "@/lib/radarr";
import { getSonarrTvSize, getSonarrActiveDownloads } from "@/lib/sonarr";
import { AdminApprovals } from "@/components/AdminApprovals";
import { StorageChart } from "@/components/StorageChart";
import { DownloadsPanel, type DownloadRow } from "@/components/DownloadsPanel";

export default async function AdminFeaturesPage() {
  const session = await getSession();
  if (!session?.user?.isAdmin) {
    redirect("/");
  }

  const [pendingUsers, storageInfo, tvSize, radarrDownloads, sonarrDownloads] = await Promise.all([
    prisma.user.findMany({
      where: { approved: false },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, createdAt: true },
    }),
    getRadarrStorageInfo(),
    getSonarrTvSize(),
    getRadarrActiveDownloads(),
    getSonarrActiveDownloads(),
  ]);

  const downloads: DownloadRow[] = [
    ...radarrDownloads.map((d) => ({ ...d, mediaType: "movie" as const })),
    ...sonarrDownloads.map((d) => ({ ...d, mediaType: "show" as const })),
  ].sort((a, b) => (b.progress ?? -1) - (a.progress ?? -1));

  return (
    <div className="min-h-screen px-4 sm:px-6 pt-24 pb-16 max-w-2xl mx-auto space-y-10">
      <h1 className="font-display text-3xl font-bold text-white">Admin Features</h1>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Pending approvals</h2>
        <AdminApprovals
          users={pendingUsers.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))}
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Downloads in progress</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <DownloadsPanel downloads={downloads} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Storage usage</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          {storageInfo ? (
            <StorageChart
              totalSpace={storageInfo.totalSpace}
              freeSpace={storageInfo.freeSpace}
              moviesSize={storageInfo.moviesSize}
              tvSize={tvSize ?? 0}
            />
          ) : (
            <p className="text-white/50 text-sm">
              Storage info unavailable — Radarr isn&apos;t configured or unreachable.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
