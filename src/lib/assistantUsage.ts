/**
 * Records every turn taken with the admin assistant.
 *
 * Distinct from the audit log on purpose. AuditLogEntry answers "what was
 * done"; most assistant turns do nothing at all. This answers "who used it,
 * from where" -- the question the visitors log already answers for page views
 * and sign-ins, which is why these rows are merged into that same timeline
 * rather than shown in a panel of their own.
 *
 * The IP is kept for the same reason the rest of the visitors log keeps one:
 * this panel is reachable from the public internet, so where an admin session
 * is being driven from is worth being able to see afterwards. It is read with
 * clientIpFromHeaders, so behind Cloudflare it is the edge's unforgeable
 * cf-connecting-ip rather than anything the client can set.
 */

import { prisma } from "./db";
import { clientIpFromHeaders } from "./loginAttemptRules";

/**
 * How much of the admin's message to keep.
 *
 * Was 200, which is about two sentences -- enough to recognise a request and
 * not enough to read one. The visitors log now shows these in full, and a
 * prompt cut mid-question is the one field in that table where the content
 * *is* the point.
 *
 * Still bounded, because this is a log rather than a transcript store: the
 * assistant's replies are never recorded here at all, only what was asked,
 * and 2000 characters is past any realistic ops question while keeping a
 * pathological paste from becoming a database problem.
 */
export const PROMPT_LOG_MAX = 2000;

export function truncatePrompt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= PROMPT_LOG_MAX ? flat : `${flat.slice(0, PROMPT_LOG_MAX - 1)}…`;
}

export async function recordAssistantUsage(params: {
  actorName: string;
  backend: string;
  prompt: string;
  headers: Headers;
}): Promise<void> {
  const headerBag: Record<string, string> = {};
  params.headers.forEach((v, k) => {
    headerBag[k] = v;
  });

  try {
    await prisma.assistantUsage.create({
      data: {
        actorName: params.actorName,
        backend: params.backend,
        prompt: truncatePrompt(params.prompt),
        ip: clientIpFromHeaders(headerBag),
        country: headerBag["cf-ipcountry"] || null,
      },
    });
  } catch (err) {
    // Logging a turn must never cost the admin the answer to it. The chat
    // route calls this before streaming, so a database hiccup here would
    // otherwise take down the assistant entirely.
    console.error("[assistantUsage] failed to record:", err);
  }
}
