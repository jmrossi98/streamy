/**
 * Every tailored resume, newest first: view (a printable page in a new tab --
 * Save as PDF from there) or download the Markdown. Kept rather than pruned so
 * it is always clear what was sent where.
 */
export function ResumeVersionsPanel({
  versions,
}: {
  versions: { id: string; company: string; title: string; model: string; createdAt: string }[];
}) {
  if (versions.length === 0) {
    return (
      <p className="text-sm text-white/50">
        None yet. Use &ldquo;tailor resume&rdquo; on a listing above. It reads your master resume and experience notes
        from the <code className="text-white/70">Resume</code> folder in the Obsidian vault.
      </p>
    );
  }
  return (
    <ul className="max-h-[28rem] space-y-1.5 overflow-y-auto pr-1">
      {versions.map((v) => (
        <li key={v.id} className="flex items-center gap-3 rounded border border-white/10 bg-black/20 px-3 py-2 text-xs">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-white">
              {v.company} · {v.title}
            </p>
            <p className="truncate text-[11px] text-white/40">
              {new Date(v.createdAt).toLocaleString()} · {v.model.split("/").pop()}
            </p>
          </div>
          <a
            href={`/resume/${v.id}`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded border border-white/15 px-2 py-0.5 text-white/70 hover:bg-white/10"
          >
            View
          </a>
          <a
            href={`/api/admin/jobs/resume/${v.id}/download`}
            className="shrink-0 rounded border border-white/15 px-2 py-0.5 text-white/70 hover:bg-white/10"
          >
            Download
          </a>
        </li>
      ))}
    </ul>
  );
}
