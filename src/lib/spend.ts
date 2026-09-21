/**
 * Live month-to-date spend for the services that can actually report it.
 *
 * Two of them can. Everything else in the overview is a figure someone typed
 * in, because nothing exposes "what has this person signed up for" -- which is
 * the whole reason the panel exists.
 *
 * Impure by nature (network, env); the arithmetic lives in spendRules.ts so it
 * stays testable without either.
 */

import { cached } from "./ttlCache";
import { AWS_SPEND_PROBLEMS, type AwsBreakdown, type AwsSpend, type AwsSpendProblem } from "./spendRules";

/** Billing APIs are not on a critical path, but a page still has to render. */
const BILLING_TIMEOUT_MS = 12_000;

/**
 * AWS month-to-date, via Cost Explorer.
 *
 * One request, grouped by service, answering both questions: the per-service
 * rows are the breakdown, and their sum is the month-to-date total. It used
 * to be two calls asking the same period twice, which mattered because Cost
 * Explorer bills a cent per request.
 *
 * Needs ce:GetCostAndUsage on the alerting credential (scoped to sns:Publish
 * by default) and Cost Explorer enabled once for the account.
 *
 * Reports *why* it has no figure rather than answering null for everything.
 * The silent version was indistinguishable from "this account costs nothing",
 * so a credential missing the Cost Explorer permission looked like a working
 * panel with an empty section, which is exactly what happened.
 */
export type { AwsSpend, AwsSpendProblem, AwsBreakdown } from "./spendRules";

async function awsSpendUncached(): Promise<AwsSpend> {
  const accessKeyId = process.env.ALERT_AWS_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.ALERT_AWS_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    return { ok: false, reason: "unconfigured", detail: AWS_SPEND_PROBLEMS.unconfigured };
  }

  try {
    const { CostExplorerClient, GetCostAndUsageCommand } = await import(
      "@aws-sdk/client-cost-explorer"
    );
    // Cost Explorer is us-east-1 only -- it is a billing-account-wide API, not
    // a per-region one.
    const client = new CostExplorerClient({
      region: "us-east-1",
      credentials: { accessKeyId, secretAccessKey },
    });
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const tomorrow = new Date(now.getTime() + 24 * 3_600_000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    const result = await client.send(
      new GetCostAndUsageCommand({
        // End is exclusive and must be strictly after Start, so "today alone"
        // is rejected -- hence tomorrow.
        TimePeriod: { Start: iso(startOfMonth), End: iso(tomorrow) },
        Granularity: "MONTHLY",
        Metrics: ["UnblendedCost"],
        GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
      })
    );

    // With GroupBy set, Cost Explorer leaves the period Total empty and puts
    // everything in Groups, so the total is the sum of the rows -- including
    // the sub-cent ones the breakdown hides.
    let monthToDate = 0;
    const byService: AwsBreakdown = [];
    for (const period of result.ResultsByTime ?? []) {
      for (const group of period.Groups ?? []) {
        const amount = Number(group.Metrics?.UnblendedCost?.Amount ?? 0);
        if (!Number.isFinite(amount)) continue;
        monthToDate += amount;
        // A row per service comes back whether or not it cost anything; a
        // page of $0.00 lines is noise.
        if (amount <= 0.005) continue;
        byService.push({ service: group.Keys?.[0] ?? "Unknown", amount });
      }
    }
    byService.sort((a, b) => b.amount - a.amount);
    return { ok: true, monthToDate, byService };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const reason: AwsSpendProblem =
      name === "AccessDeniedException" || name === "UnrecognizedClientException"
        ? "denied"
        : name === "DataUnavailableException"
          ? "notEnabled"
          : "error";
    // Logged because the panel only shows the category; the SDK message is
    // what actually names the missing permission.
    console.error("[spend] Cost Explorer failed:", name, err);
    return {
      ok: false,
      reason,
      detail: err instanceof Error && err.message ? err.message : AWS_SPEND_PROBLEMS[reason],
    };
  }
}

export type OpenRouterCredits = { used: number; limit: number | null };

/**
 * OpenRouter usage and remaining credit.
 *
 * Uses the same inference key the chat panel does, and its /key endpoint,
 * which reports on the key making the request. `limit` is null on an account
 * with no cap set, which is not the same as zero -- one means unlimited, the
 * other means spent out.
 */
async function openRouterCreditsUncached(): Promise<OpenRouterCredits | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(BILLING_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { usage?: number; limit?: number | null } };
    const used = Number(body?.data?.usage ?? 0);
    if (!Number.isFinite(used)) return null;
    const rawLimit = body?.data?.limit;
    return {
      used,
      limit: typeof rawLimit === "number" && Number.isFinite(rawLimit) ? rawLimit : null,
    };
  } catch {
    return null;
  }
}

/**
 * How long a billing figure is allowed to be stale.
 *
 * Six hours for AWS because Cost Explorer only refreshes its own data a few
 * times a day, and because it bills a cent per request -- the admin panel
 * re-renders on a timer, so uncached this was a standing charge for a number
 * that hadn't moved. Ten minutes for OpenRouter: free to ask, but credits
 * only move when someone uses the chat panel.
 */
const AWS_TTL_MS = 6 * 3_600_000;
const OPENROUTER_TTL_MS = 10 * 60_000;

export function awsSpend(): Promise<AwsSpend> {
  // Failures are cached too, and deliberately: a denied credential stays
  // denied until someone changes an IAM policy, and retrying it on every
  // render is a request billed to say so again.
  return cached("spend:aws", AWS_TTL_MS, awsSpendUncached);
}

export function openRouterCredits(): Promise<OpenRouterCredits | null> {
  return cached("spend:openrouter", OPENROUTER_TTL_MS, openRouterCreditsUncached);
}
