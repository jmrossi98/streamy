import { PanelBoundary } from "@/components/PanelBoundary";
import { JobListingsPanel } from "@/components/JobListingsPanel";
import { getJobPostings, isJobBoardConfigured } from "@/lib/jobPostings";

export default async function AdminJobsPage() {
  const jobListings = await getJobPostings();

  return (
      <div className="space-y-10">
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Job listings</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PanelBoundary name="Job listings">
            <JobListingsPanel
              configured={isJobBoardConfigured()}
              listings={jobListings.map((job) => ({
                id: job.id,
                company: job.company,
                title: job.title,
                location: job.location,
                url: job.url,
                metros: job.metros,
                remote: job.remote,
                firstSeen: job.firstSeen.toISOString(),
              }))}
            />
          </PanelBoundary>
        </div>
      </section>
      </div>
  );
}
