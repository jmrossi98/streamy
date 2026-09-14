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

/** Billing APIs are not on a critical path, but a page still has to render. */
const BILLING_TIMEOUT_MS = 12_000;

/**
 * AWS month-to-date, via Cost Explorer.
 *
 * Lifted from the old health check, which asked a different question: it
 * compared spend to a ceiling and reported pass/fail. A threshold alarm tells
 * you when something is wrong; it never tells you what you are paying, and the
 * second is what was actually wanted.
 *
 * Needs ce:GetCostAndUsage on the alerting credential (scoped to sns:Publish
 * by default) and Cost Explorer enabled once for the account. Returns null
 * rather than throwing when either is missing -- unconfigured, not broken.
 */
export async function awsMonthToDate(): Promise<number | null> {
  const accessKeyId = process.env.ALERT_AWS_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.ALERT_AWS_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;

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
      })
    );
    const mtd = result.ResultsByTime?.reduce(
      (sum, r) => sum + Number(r.Total?.UnblendedCost?.Amount ?? 0),
      0
    );
    return mtd != null && Number.isFinite(mtd) ? mtd : null;
  } catch {
    return null;
  }
}

export type AwsBreakdown = { service: string; amount: number }[];

/** Which AWS services the spend actually went to -- the "some detail" asked for. */
export async function awsBreakdown(): Promise<AwsBreakdown> {
  const accessKeyId = process.env.ALERT_AWS_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.ALERT_AWS_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return [];

  try {
    const { CostExplorerClient, GetCostAndUsageCommand } = await import(
      "@aws-sdk/client-cost-explorer"
    );
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
        TimePeriod: { Start: iso(startOfMonth), End: iso(tomorrow) },
        Granularity: "MONTHLY",
        Metrics: ["UnblendedCost"],
        GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
      })
    );

    const rows: AwsBreakdown = [];
    for (const period of result.ResultsByTime ?? []) {
      for (const group of period.Groups ?? []) {
        const amount = Number(group.Metrics?.UnblendedCost?.Amount ?? 0);
        // Cost Explorer returns a row per service whether or not it cost
        // anything; a page of $0.00 lines is noise.
        if (!Number.isFinite(amount) || amount <= 0.005) continue;
        rows.push({ service: group.Keys?.[0] ?? "Unknown", amount });
      }
    }
    return rows.sort((a, b) => b.amount - a.amount);
  } catch {
    return [];
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
export async function openRouterCredits(): Promise<OpenRouterCredits | null> {
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
