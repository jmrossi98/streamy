import { notFound, redirect } from "next/navigation";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { renderMarkdownSafe } from "@/lib/markdownSafe";
import { ResumePrintButton } from "./ResumePrintButton";

export const dynamic = "force-dynamic";

/**
 * One tailored resume, laid out as a printable page: the browser's
 * Print -> Save as PDF gives the file to upload. The notes (what was
 * emphasised, gaps, research) are on screen only and never print.
 */
export default async function ResumeVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await requireAdmin(session))) notFound();
  const { id } = await params;
  const row = await prisma.resumeVersion.findUnique({ where: { id } });
  if (!row) notFound();

  return (
    <div className="min-h-screen bg-neutral-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[8.5in] flex-wrap items-center gap-3 px-4 text-sm text-neutral-600 print:hidden">
        <span>
          {row.company} · {row.title} · {row.createdAt.toLocaleString()} · {row.model}
        </span>
        <span className="ml-auto flex gap-2">
          <ResumePrintButton />
          <a
            href={`/api/admin/jobs/resume/${row.id}/download`}
            className="rounded border border-neutral-300 bg-white px-3 py-1 text-neutral-800 hover:bg-neutral-50"
          >
            Download .md
          </a>
          {row.url && (
            <a
              href={row.url}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded border border-neutral-300 bg-white px-3 py-1 text-neutral-800 hover:bg-neutral-50"
            >
              Open listing
            </a>
          )}
        </span>
      </div>

      <article
        className="resume-doc mx-auto max-w-[8.5in] bg-white px-[0.6in] py-[0.5in] text-[10.5pt] leading-snug text-neutral-900 shadow print:shadow-none"
        dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(row.markdown) }}
      />

      {row.notes && (
        <section className="mx-auto mt-6 max-w-[8.5in] rounded border border-amber-300 bg-amber-50 px-6 py-4 text-sm text-neutral-800 print:hidden">
          <h2 className="mb-2 font-semibold">Notes (not part of the resume)</h2>
          <div className="resume-notes" dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(row.notes) }} />
        </section>
      )}

      <style>{`
        .resume-doc h1 { font-size: 20pt; font-weight: 700; margin: 0 0 2pt; }
        .resume-doc h2 { font-size: 11pt; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
          border-bottom: 1px solid #999; margin: 10pt 0 4pt; padding-bottom: 1pt; }
        .resume-doc h3 { font-size: 10.5pt; font-weight: 700; margin: 6pt 0 1pt; }
        .resume-doc p { margin: 2pt 0; }
        .resume-doc ul { list-style: disc; padding-left: 14pt; margin: 2pt 0; }
        .resume-doc li { margin: 1pt 0; }
        .resume-doc a { color: inherit; }
        .resume-notes ul { list-style: disc; padding-left: 16px; }
        .resume-notes a { color: #1d4ed8; text-decoration: underline; }
        @page { size: letter; margin: 0; }
      `}</style>
    </div>
  );
}
