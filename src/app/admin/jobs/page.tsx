import { AdminSection } from "@/components/ui";
import { JobListingsPanel } from "@/components/JobListingsPanel";
import { JobSourcesPanel } from "@/components/JobSourcesPanel";
import { getHiddenExecPostings, getJobPostings, isJobBoardConfigured, jobSources } from "@/lib/jobPostings";
import { SCRAPED_STALE_AFTER_MS, sourceHealth } from "@/lib/jobSourceHealthRules";
import { isScrapedProvider, sortSourceRows } from "@/lib/jobBoardRules";
import { nextDigestAt, parseDigestCadence } from "@/lib/jobDigestRules";
import { getJobAlertLevels, getJobDigestCadenceRaw, getJobDigestLastAt } from "@/lib/appSettings";
import { listResumeVersions } from "@/lib/resume";
import { recentResumeJobs } from "@/lib/resumeJobs";
import { ResumeVersionsPanel } from "@/components/ResumeVersionsPanel";
import { ResumeKnowledgeBasePanel } from "@/components/ResumeKnowledgeBasePanel";
import { ApplicantProfilePanel } from "@/components/ApplicantProfilePanel";
import { getApplicantProfile } from "@/lib/applyPacket";
import { prisma } from "@/lib/db";
import { LlmRoutingPanel } from "@/components/LlmRoutingPanel";
import { routingSnapshot } from "@/lib/llm";
import { usesIn } from "@/lib/llmRoutingRules";

export default async function AdminJobsPage() {
  // Started first, read below: the "AI models" section's routing.
  const routingPromise = routingSnapshot();
  // Above the whole matched set, not a round number: filtering happens in the
  // browser, so anything the cap drops is invisible to the metro, company and
  // category filters and they quietly lie about what is open. Fifty-seven
  // boards matched over 1,500 roles on 2026-09-26.
  const [jobListings, sources, configured, alertLevels, resumes, cadenceRaw, lastDigestAt, profile, applications, resumeJobs, hiddenExec] = await Promise.all([
    getJobPostings(3000),
    jobSources(),
    isJobBoardConfigured(),
    getJobAlertLevels(),
    listResumeVersions().catch(() => []),
    getJobDigestCadenceRaw(),
    getJobDigestLastAt(),
    getApplicantProfile(),
    prisma.jobApplication
      .findMany({ orderBy: { createdAt: "asc" }, select: { id: true, postingId: true, status: true } })
      .catch(() => []),
    // In-progress and recent tailoring runs, so the buttons come back as they were.
    recentResumeJobs().catch(() => ({})),
    getHiddenExecPostings(),
  ]);
  // Newest wins: ordered oldest first, so later rows overwrite.
  const applicationByPosting = new Map(applications.map((a) => [a.postingId, { id: a.id, status: a.status }]));
  const checkedAt = new Date();
  const cadence = parseDigestCadence(cadenceRaw);
  const nextDigest = nextDigestAt(cadence, lastDigestAt, checkedAt);

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
          resumeJobs={resumeJobs}
          hiddenExec={hiddenExec}
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

      <AdminSection title="Resume knowledge base">
        <ResumeKnowledgeBasePanel />
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

      {/* 2026-10-24: moved here from the assistant's Model routing panel,
          beside the resumes and apply packets these models write. Same
          stored routing; the assistant panel keeps the chat slots. */}
      <AdminSection title="AI models">
        <LlmRoutingPanel initial={await routingPromise} uses={usesIn("jobs")} />
      </AdminSection>

      <AdminSection title="Boards watched">
        <JobSourcesPanel
          alertLevels={alertLevels}
          digestCadence={cadence}
          nextDigestAt={nextDigest?.toISOString() ?? null}
          // API boards and the career sites mediabox scrapes, in one list
          // since 2026-10-24: the scraped ones are rows like any other, with
          // a Custom badge, so each has the same switches.
          sources={sortSourceRows(
            sources.map((src) => {
              const custom = isScrapedProvider(src.provider);
              return {
                id: src.id,
                provider: src.provider,
                slug: src.slug,
                company: src.company,
                custom,
                enabled: src.enabled,
                notify: src.notify,
                notifyImmediately: src.notifyImmediately,
                tag: src.tag,
                note: src.note,
                openRoles: openByCompany.get(src.company) ?? 0,
                health: sourceHealth(src, checkedAt, custom ? { staleAfterMs: SCRAPED_STALE_AFTER_MS } : {}),
              };
            })
          )}
        />
      </AdminSection>
      </div>
  );
}
