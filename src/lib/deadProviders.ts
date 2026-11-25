/**
 * The IPTV providers nothing can play from right now: every line dead, the
 * main login included when the renewal probe says it lapsed. Server-only;
 * the rule is providerAvailability.ts deadProviders.
 */
import { listIptvAccountsCached } from "./dispatcharr";
import { getAutomaticRenewals } from "./renewals";
import { deadProviders, expiredMainLogins } from "./providerAvailability";

export async function getDeadProviders(): Promise<Set<string>> {
  const [accounts, renewals] = await Promise.all([
    listIptvAccountsCached().catch(() => null),
    getAutomaticRenewals().catch(() => []),
  ]);
  return deadProviders(accounts, expiredMainLogins(renewals));
}
