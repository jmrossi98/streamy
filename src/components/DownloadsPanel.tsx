export type DownloadRow = { title: string; progress: number | null; mediaType: "movie" | "show" };

export function DownloadsPanel({ downloads }: { downloads: DownloadRow[] }) {
  if (downloads.length === 0) {
    return <p className="text-white/50 text-sm">Nothing downloading right now.</p>;
  }

  return (
    <ul className="space-y-3">
      {downloads.map((d) => (
        <li key={d.mediaType + d.title} className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-white/90 truncate">{d.title}</span>
            <span className="text-white/50 shrink-0 tabular-nums">
              {d.progress != null ? `${d.progress}%` : "metadata…"}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            {d.progress != null ? (
              <div
                className="h-full rounded-full bg-netflix-red transition-[width] duration-500"
                style={{ width: `${d.progress}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-white/20" />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
