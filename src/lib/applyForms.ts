/**
 * Fetches one job's application form from its provider. See applyFormRules.ts
 * for the shape and why these two providers.
 */
import { ashbyFields, greenhouseFields, type ApplyTarget, type FormField } from "./applyFormRules";

const TIMEOUT_MS = 20_000;

const ASHBY_QUERY = `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    id title
    applicationForm { sections { fieldEntries { ... on FormFieldEntry { field isRequired } } } }
    surveyForms { sections { fieldEntries { ... on FormFieldEntry { field isRequired } } } }
  }
}`;

export async function fetchApplicationForm(target: ApplyTarget): Promise<FormField[]> {
  if (target.provider === "greenhouse") {
    const res = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(target.slug)}/jobs/${encodeURIComponent(target.jobId)}?questions=true`,
      { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" }
    );
    if (res.status === 404) throw new Error("This job is no longer open on Greenhouse.");
    if (!res.ok) throw new Error(`Greenhouse returned HTTP ${res.status}`);
    return greenhouseFields(await res.json());
  }
  const res = await fetch("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operationName: "ApiJobPosting",
      variables: { organizationHostedJobsPageName: target.slug, jobPostingId: target.jobId },
      query: ASHBY_QUERY,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Ashby returned HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { jobPosting?: Parameters<typeof ashbyFields>[0] | null }; errors?: { message?: string }[] };
  if (body.errors?.length) throw new Error(`Ashby: ${body.errors[0].message ?? "query failed"}`);
  if (!body.data?.jobPosting) throw new Error("This job is no longer open on Ashby.");
  return ashbyFields(body.data.jobPosting);
}
