import { AdminSection } from "@/components/ui";
import { JobListingsPanel } from "@/components/JobListingsPanel";
import { JobSourcesPanel } from "@/components/JobSourcesPanel";
import { getJobPostings, isJobBoardConfigured, jobSources, scrapedSiteReport } from "@/lib/jobPostings";
import { HEALTH_RANK, scrapedSiteHealth, sourceHealth } from "@/lib/jobSourceHealthRules";
import { getJobAlertLevels } from "@/lib/appSettings";
import { listResumeVersions } from "@/lib/resume";
import { ResumeVersionsPanel } from "@/components/ResumeVersionsPanel";
import { ApplicantProfilePanel } from "@/components/ApplicantProfilePanel";
import { getApplicantProfile } from "@/lib/applyPacket";
import { prisma } from "@/lib/db";

export default async function AdminJobsPage() {
  // Above the whole matched set, not a round number: filtering happens in the
  // browser, so anything the cap drops is invisible to the metro, company and
  // category filters and they quietly lie about what is open. Fifty-seven
  // boards matched over 1,500 roles on 2026-09-26.
  const [jobListings, sources, configured, alertLevels, resumes, scrapeReport, profile, applications] = await Promise.all([
    getJobPostings(3000),
    jobSources(),
    isJobBoardConfigured(),
    getJobAlertLevels(),
    listResumeVersions().catch(() => []),
    scrapedSiteReport(),
    getApplicantProfile(),
    prisma.jobApplication
      .findMany({ orderBy: { createdAt: "asc" }, select: { id: true, postingId: true, status: true } })
      .catch(() => []),
  ]);
  // Newest wins: ordered oldest first, so later rows overwrite.
  const applicationByPosting = new Map(applications.map((a) => [a.postingId, { id: a.id, status: a.status }]));
  const checkedAt = new Date();
  const scrapedSites = scrapeReport.sites
    .map((site) => ({
      company: site.company,
      count: site.count,
      health: scrapedSiteHealth(site, scrapeReport.generatedAt, checkedAt),
    }))
    .sort((a, b) => HEALTH_RANK[a.health.status] - HEALTH_RANK[b.health.status]);

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
      <AdminSection title="Job listings">
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
            application: applicationByPosting.get(job.id) ?? null,
          }))}
        />
      </AdminSection>

      <AdminSection title="Applicant profile">
        <ApplicantProfilePanel initial={profile} />
      </AdminSection>

      <AdminSection title="Tailored resumes">
        <ResumeVersionsPanel
          versions={resumes.map((r) => ({
            id: r.id,
            company: r.company,
            title: r.title,
            model: r.model,
            createdAt: r.createdAt.toISOString(),
          }))}
        />
      </AdminSection>

      <AdminSection title="Boards watched">
        <JobSourcesPanel
          alertLevels={alertLevels}
          scrapedSites={scrapedSites}
          sources={sources.map((src) => ({
            id: src.id,
            provider: src.provider,
            slug: src.slug,
            company: src.company,
            enabled: src.enabled,
            notify: src.notify,
            tag: src.tag,
            openRoles: openByCompany.get(src.company) ?? 0,
            health: sourceHealth(src, checkedAt),
          }))}
        />
      </AdminSection>
      </div>
  );
}
