/**
 * Turning a list of subscriptions into a monthly figure.
 *
 * Pure, so it tests without the database or any billing API.
 */

export type Cadence = "monthly" | "yearly" | "metered" | "free";

export type SubscriptionLike = {
  name: string;
  cost: number;
  cadence: string;
  active: boolean;
};

export type SpendTotals = {
  /** Everything with a knowable recurring price, normalised to a month. */
  fixedMonthly: number;
  /** What the metered services actually billed this month, pulled live. */
  meteredMonthly: number;
  /** The headline figure. */
  totalMonthly: number;
  /** Metered services with no live figure available -- the total is short by these. */
  unknownMetered: string[];
};

/** A yearly price as a monthly one. */
export function monthlyEquivalent(cost: number, cadence: string): number {
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  switch (cadence) {
    case "monthly":
      return cost;
    case "yearly":
      return cost / 12;
    // Metered has no fixed price to normalise, and free has none to count.
    // Both are deliberately zero here rather than guessed at.
    default:
      return 0;
  }
}

/**
 * The running monthly total.
 *
 * Fixed and metered are kept apart on purpose. A flat $10/month and a variable
 * AWS bill are different kinds of number, and adding a guess for the second
 * would make the headline quietly wrong in a way nobody could see. Metered
 * services contribute only what was actually billed, and any that couldn't be
 * read are named so the total can be understood as incomplete rather than
 * trusted as exact.
 */
export function computeTotals(
  subs: SubscriptionLike[],
  /** Live month-to-date figures, keyed by subscription name. */
  meteredActuals: Record<string, number | null> = {}
): SpendTotals {
  const active = subs.filter((s) => s.active);

  const fixedMonthly = active.reduce(
    (sum, s) => sum + monthlyEquivalent(s.cost, s.cadence),
    0
  );

  let meteredMonthly = 0;
  const unknownMetered: string[] = [];
  for (const s of active) {
    if (s.cadence !== "metered") continue;
    const actual = meteredActuals[s.name];
    if (typeof actual === "number" && Number.isFinite(actual)) meteredMonthly += actual;
    else unknownMetered.push(s.name);
  }

  return {
    fixedMonthly,
    meteredMonthly,
    totalMonthly: fixedMonthly + meteredMonthly,
    unknownMetered,
  };
}

/** Money, for display. */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** Per-cadence label, so a yearly price shows its monthly equivalent too. */
export function describeCost(cost: number, cadence: string): string {
  switch (cadence) {
    case "free":
      return "Free";
    case "metered":
      return "Metered";
    case "yearly":
      return `${formatUsd(cost)}/yr (${formatUsd(cost / 12)}/mo)`;
    default:
      return `${formatUsd(cost)}/mo`;
  }
}

/**
 * Why there is no AWS figure, when there isn't one.
 *
 * Here rather than in spend.ts because the panel is a client component and
 * spend.ts reaches for the AWS SDK -- these are strings and shapes, and they
 * have no business pulling a server module into the browser bundle.
 */
export type AwsSpendProblem = "unconfigured" | "denied" | "notEnabled" | "error";

export type AwsBreakdown = { service: string; amount: number }[];

export type AwsSpend =
  | { ok: true; monthToDate: number; byService: AwsBreakdown }
  | { ok: false; reason: AwsSpendProblem; detail: string };

/** What the panel should tell an admin to go do about it. */
export const AWS_SPEND_PROBLEMS: Record<AwsSpendProblem, string> = {
  unconfigured: "No AWS credentials set on the server.",
  denied: "The AWS credential is missing the ce:GetCostAndUsage permission.",
  notEnabled: "Cost Explorer hasn't been enabled for this AWS account yet.",
  error: "Cost Explorer couldn't be reached.",
};
