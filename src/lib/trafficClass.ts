/**
 * Tags a page visit as a person or an automated client.
 *
 * A guess, not a verdict, and it never hides anything -- the log shows every
 * row either way. Two signals, strongest first:
 *
 *   1. The user agent names itself as a bot (AhrefsBot, bingbot, curl...).
 *   2. The address belongs to a cloud or hosting network. People browse from
 *      home ISPs and phone carriers; a "visitor" on an Amazon EC2 box is a
 *      script, whatever browser it claims to be. A person on a VPN can land
 *      here too, which is why this is "likely bot" rather than "bot".
 *
 * CDN networks (Cloudflare, Akamai, Fastly) are deliberately not on the list:
 * iCloud Private Relay and Cloudflare WARP exit through them, and those are
 * real people.
 */

export type TrafficClass = "human" | "likely-bot" | "bot";

export type TrafficVerdict = { class: TrafficClass; reason: string };

// Matches the self-identifying crawlers and tools seen in the wild. Kept to
// tokens no ordinary browser sends.
const BOT_UA =
  /bot\b|bot\/|crawler|spider|slurp|headless|externalagent|webindexer|facebookexternalhit|preview|scan|lighthouse|pingdom|uptime|monitor|curl\/|wget\/|python|go-http|java\/|okhttp|httpclient|node-fetch|axios|phantomjs|puppeteer|playwright|selenium/i;

/**
 * Cloud and hosting networks, by ASN. Names drift in the database, numbers
 * don't, so the match is on the number.
 */
export const DATACENTER_ASNS: ReadonlyMap<number, string> = new Map([
  [14618, "Amazon AWS"],
  [16509, "Amazon AWS"],
  [8075, "Microsoft Azure"],
  [15169, "Google"],
  [396982, "Google Cloud"],
  [16276, "OVH"],
  [14061, "DigitalOcean"],
  [24940, "Hetzner"],
  [63949, "Akamai Linode"],
  [20473, "Vultr"],
  [31898, "Oracle Cloud"],
  [45102, "Alibaba Cloud"],
  [132203, "Tencent Cloud"],
  [51167, "Contabo"],
  [12876, "Scaleway"],
  [60781, "Leaseweb"],
  [16265, "Leaseweb"],
  [9009, "M247"],
  [212238, "Datacamp"],
  [46606, "Unified Layer"],
  [36352, "ColoCrossing"],
  [53667, "FranTech"],
]);

/** Pulls a readable bot name out of a user agent, e.g. "AhrefsBot". */
function botName(ua: string): string {
  const named = ua.match(/([A-Za-z][\w.-]*?(?:bot|crawler|spider|agent|indexer))\b/i);
  if (named) return named[1];
  const tool = ua.match(/^([\w.-]+)\//);
  return tool ? tool[1] : "automated client";
}

export function classifyTraffic(input: {
  userAgent: string | null;
  asn: number | null;
  org?: string | null;
}): TrafficVerdict {
  const ua = input.userAgent?.trim() ?? "";
  if (!ua) return { class: "bot", reason: "no user agent" };
  if (BOT_UA.test(ua)) return { class: "bot", reason: botName(ua) };

  const host = input.asn != null ? DATACENTER_ASNS.get(input.asn) : undefined;
  if (host) return { class: "likely-bot", reason: `${host} data center` };

  return { class: "human", reason: input.org ? `on ${input.org}` : "no bot signals" };
}
