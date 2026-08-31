/**
 * Human-readable file size for one download/file -- MB for anything under a
 * GB (a 300MB episode reading as "0.3 GB" is less legible than "300 MB"),
 * GB beyond that, TB past 1000 GB. Distinct from StorageChart's own
 * formatBytes, which is GB/TB-only and fine for that -- a whole disk is
 * never going to read in MB.
 */
export function formatFileSize(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  const mb = bytes / 1024 ** 2;
  if (mb < 1000) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = bytes / 1024 ** 3;
  if (gb < 1000) return `${gb.toFixed(1)} GB`;
  const tb = bytes / 1024 ** 4;
  return `${tb.toFixed(1)} TB`;
}
