import { PanelBoundary } from "@/components/PanelBoundary";
import { JobListingsPanel } from "@/components/JobListingsPanel";
import { JobSourcesPanel } from "@/components/JobSourcesPanel";
import { getJobPostings, isJobBoardConfigured, jobSources } from "@/lib/jobPostings";
import { getJobAlertLevels } from "@/lib/appSettings";
import { listResumeVersions } from "@/lib/resume";
import { ResumeVersionsPanel } from "@/components/ResumeVersionsPanel";

export default async function AdminJobsPage() {
  // Above the whole matched set, not a round number: filtering happens in the
  // browser, so anything the cap drops is invisible to the metro, company and
  // category filters and they quietly lie about what is open. Fifty-seven
  // boards matched over 1,500 roles on 2026-09-26.
  const [jobListings, sources, configured, alertLevels, resumes] = await Promise.all([
    getJobPostings(3000),
    jobSources(),
    isJobBoardConfigured(),
    getJobAlertLevels(),
    listResumeVersions().catch(() => []),
  ]);

  // Counted from the postings rather than stored on the board, so the number
  // is always what the list actually holds -- a board can be configured and
  // contributing nothing, which is worth seeing.
  const tagByCompany = new Map<string, string>();
  for (const src of sources) {
    if (src.tag) tagByCompany.set(src.company, src.tag);
  }

  const openByCompany = new Map<string, number>();
  for (const job of jobListings) {
    openByCompany.set(job.company, (openByCompany.get(job.company) ?? 0) + 1);
  }

  return (
      <div className="space-y-10">
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Job listings</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PanelBoundary name="Job listings">
            <JobListingsPanel
              configured={configured}
              listings={jobListings.map((job) => ({
                id: job.id,
                company: job.company,
                title: job.title,
                location: job.location,
                url: job.url,
                metros: job.metros,
                remote: job.remote,
                category: job.category,
                level: job.level,
                opened: job.openedAt !== null,
                tag: tagByCompany.get(job.company) ?? null,
                postedAt: job.postedAt?.toISOString() ?? null,
                firstSeen: job.firstSeen.toISOString(),
              }))}
            />
          </PanelBoundary>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Tailored resumes</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PanelBoundary name="Tailored resumes">
            <ResumeVersionsPanel
              versions={resumes.map((r) => ({
                id: r.id,
                company: r.company,
                title: r.title,
                model: r.model,
                createdAt: r.createdAt.toISOString(),
              }))}
            />
          </PanelBoundary>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Boards watched</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PanelBoundary name="Boards watched">
            <JobSourcesPanel
              alertLevels={alertLevels}
              sources={sources.map((src) => ({
                id: src.id,
                provider: src.provider,
                slug: src.slug,
                company: src.company,
                enabled: src.enabled,
                notify: src.notify,
                tag: src.tag,
                openRoles: openByCompany.get(src.company) ?? 0,
              }))}
            />
          </PanelBoundary>
        </div>
      </section>
      </div>
  );
}
