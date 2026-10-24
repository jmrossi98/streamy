/**
 * Input limits for the admin chat panel.
 *
 * Pure, so it tests without the server stack.
 *
 * Two jobs. One is keeping requests inside the 8k context the 4GB card can
 * hold -- overflow doesn't error, it silently evicts the start of the
 * conversation. The other is a trust boundary: the browser sends a transcript,
 * and a transcript is data. Roles are re-derived rather than trusted, so a
 * crafted request can't slip in its own `system` turn and rewrite the model's
 * instructions.
 */

import type { ChatMessage } from "./ollama";
import type { ChatBackendId } from "./chatModels";

/** Characters per message. Roughly 2k tokens -- well clear of a typed question. */
export const MAX_MESSAGE_CHARS = 8000;

/**
 * Prior turns kept, newest first. Beyond this the context starts evicting.
 *
 * Sized for the 8k the 4GB card can hold, and left at that for the cloud
 * backends too even though they could take far more: on a metered backend the
 * history is re-sent and re-billed on every single turn, so an unbounded
 * transcript is a bill that grows quadratically with the conversation.
 */
export const MAX_HISTORY_MESSAGES = 20;

/**
 * Shared by every backend: who the assistant is and what it may not do.
 *
 * Rewritten 2026-10-24 from "a concise assistant embedded in a media server
 * admin panel": the admin uses this from his phone as his everyday assistant,
 * and that framing had models steering a budgeting or music question back to
 * the stack. It is now a general assistant that is *also* the stack's ops
 * assistant. The ops safety rules below are unchanged in substance.
 */
const BASE_PROMPT =
  "You are Jake's personal assistant, running inside Streamy, the self-hosted " +
  "media server he administers. He usually talks to you from his phone. Help with " +
  "anything he asks: general knowledge, everyday tasks, writing, planning, " +
  "budgeting and personal finance, deal hunting, music, politics, philosophy, " +
  "and his homelab. Discuss contested topics honestly and in substance -- give " +
  "the strongest versions of the main views, say where the evidence points, and " +
  "share a considered opinion when he asks for one. For money questions, be " +
  "concrete (numbers, trade-offs, what to check) and mention when something " +
  "depends on his situation or deserves a professional. Answer directly and " +
  "concisely; go longer only when the question needs it. Only bring up the " +
  "stack when the question is about it.\n\n" +
  // The failure this fixes: asked to summarise the stack, the model correctly
  // explained it had no live access and listed `docker ps` for the admin to run
  // -- while Streamy was already probing all of it for the admin page. Same
  // lesson as the search block below: a context block nobody told the model
  // about gets disowned rather than used.
  "You DO have a live view of the admin's stack when a stack status block " +
  "appears below. That block is Streamy's own probes, run seconds ago against " +
  "their real services -- it is your own live view, not something they pasted. " +
  "Answer from it directly rather than saying you lack access or asking them " +
  "to go run commands for information already in it. When no such block " +
  "appears, you genuinely have no live state: say so. When the question is not " +
  "about the stack, ignore the block.\n\n" +
  // Was "no shell and no tools", which stopped being true when the diag loop
  // and then the web tools landed. The boundary that matters is still
  // enforced structurally -- read-only lookups only, and every change behind
  // a button the admin taps -- so this paragraph's job is to stop the model
  // claiming it has *already* changed something, which reads as a promise
  // the admin then waits on.
  "You cannot change anything yourself. You have no shell. The only things " +
  "you can do on your own are read-only lookups, when a tools block below " +
  "describes them (live diagnostics, web search, reading a page). Anything that " +
  "changes the stack you can only PROPOSE, as one of a small set of fixed " +
  "actions, which the admin then confirms with a button before anything " +
  "happens. Never say you have restarted, changed, or fixed something -- at " +
  "most you have offered to.\n\n" +
  "To offer an action, end your reply with a fenced block exactly like this:\n" +
  "```streamy-action\n" +
  '{"action": "container.restart", "target": "prowlarr"}\n' +
  "```\n" +
  "Only these actions exist. Anything else is ignored:\n" +
  "- `container.restart`, target one of: flaresolverr, prowlarr, radarr, " +
  "sonarr, sabnzbd, gamarr, dispatcharr.\n" +
  "Do not offer to restart gluetun, tailscale-exit, or jellyfin -- restarting " +
  "those can cut the admin's own access or interrupt someone watching, so they " +
  "are done by hand. Only include a block when an action is genuinely the next " +
  "step; a diagnosis on its own is usually the more useful answer.\n\n" +
  // The same lesson as search below: the vault block was there, but nothing
  // said the model could read the vault, so it asked the admin to paste their
  // resume.
  "You DO have read access to the admin's Obsidian vault -- notes, Word files " +
  "and PDFs, including their resumes and a copy of their Apple Notes " +
  "(main/apple-notes/), plus Claude Code's memory from their " +
  "other machines. Relevant excerpts are retrieved for you and appear below; " +
  "use them. When none appear, nothing relevant was found: say that, rather " +
  "than asking the admin to paste something.\n\n" +
  // Without this the model used search results while insisting it couldn't
  // search, because nothing told it the results were its own lookup.
  "You DO have web search and can read web pages when a WEB TOOLS block " +
  "appears below; the results you get back are your own live lookups. Use them " +
  "for anything current, and cite the URLs you relied on. When no WEB TOOLS " +
  "block appears, web search is unavailable: answer from what you know, say " +
  "that you couldn't check, and note when your knowledge may be out of date.";


/**
 * The 3B model needs to be told it is small.
 *
 * Without it, it answers homelab questions with confident invented specifics,
 * which is worse than useless when the whole point is troubleshooting.
 */
const LOCAL_CAVEAT =
  "\n\nYou are a small 3B model running on the admin's own hardware. When you " +
  "are not confident about a fact, say so plainly rather than guessing.";

/**
 * The default prompt, and the one the local backend uses.
 *
 * Kept as a named export because it is what the panel runs by default and what
 * most of the tests assert against.
 */
export const SYSTEM_PROMPT = BASE_PROMPT + LOCAL_CAVEAT;

/**
 * The instructions for a given backend.
 *
 * The cloud models get the base prompt without the small-model caveat --
 * telling a frontier model to hedge like a 3B one just makes it hedge.
 */
export function systemPromptFor(backend: ChatBackendId): string {
  return backend === "local" ? SYSTEM_PROMPT : BASE_PROMPT;
}

/**
 * Messages too trivial to be worth a lookup.
 *
 * "Always search when the toggle is on" turned out to be too blunt: a user
 * typing "hey" got a dictionary definition of the word, because the greeting
 * was dutifully searched and summarised. Conversational filler and
 * meta-questions about the assistant itself are answered from the transcript,
 * not the web.
 */
const NO_SEARCH_PATTERNS = [
  /^(hi|hey|hello|yo|sup|thanks|thank you|ok|okay|cool|nice|lol|yes|no|nvm)\b[\s!.?]*$/i,
  /^(what|who) are you\b/i,
  // Questions about the user's own infrastructure. The web knows nothing about
  // this particular homelab, and irrelevant results measurably degrade a 3B
  // model's answer, because it tries to reconcile them with the question.
  /\b(my|our|the)\b[\w\s']*\b(homelab|home lab|server|stack|setup|downloads|library|queue|indexer|torrent)\b/i,
  /\b(radarr|sonarr|jellyfin|qbittorrent|prowlarr|gluetun|streamy|ollama|searxng)\b/i,
];

/**
 * Past this, the message is pasted material -- a log, a health check, an error
 * dump -- and the task is to summarise it, not look it up. A wall of text also
 * makes a useless search query.
 */
const MAX_SEARCH_QUERY_CHARS = 300;

/** "can you search the web", "do you have internet access", "are you online". */
const CAPABILITY_QUESTION = /^(can|do|are|will) you\b.*\b(web|internet|online|search|browse|google)\b/i;

/**
 * Above this, a capability question has picked up a real subject.
 *
 * Word count rather than a trailing anchor, because the topic word isn't
 * reliably last -- "do you have internet access" ends on "access". Five words
 * is a question about the assistant; "can you search the web for hotdogs" is
 * seven and is a genuine request.
 */
const MAX_CAPABILITY_QUESTION_WORDS = 6;

/**
 * Conversational filler: a whole message made of greetings and
 * acknowledgements, in any combination ("hi", "ok thanks", "yes cool").
 */
const FILLER_ONLY =
  /^(?:(?:hi|hey|hello|yo|sup|thanks|thank you|ta|ok|okay|k|cool|nice|great|lol|haha|yes|yeah|yep|no|nope|nvm|bye|goodbye|morning|good morning|good night)[\s!.?,]*)+$/i;

/** Questions about the assistant rather than about the stack. */
const ABOUT_ITSELF = /^(what|who) are you\b|^what can you do\b/i;

/**
 * Whether a user turn should carry the live stack status.
 *
 * The bug: "hi" was answered with a full service-health summary, because the
 * status block is injected immediately before the final user turn and a model
 * reading 22 lines of probe output followed by "hi" reasonably concludes it
 * was asked about them.
 *
 * Exactly the failure `shouldSearch` already exists to prevent -- "hey" once
 * came back as a dictionary definition of the word -- so it gets the same
 * treatment rather than a second discovery of the same lesson.
 *
 * Note this is NOT the inverse of shouldSearch, and the two must not be
 * merged. shouldSearch skips questions about this homelab because the web
 * knows nothing about it; those are precisely the questions that most need the
 * status block. Only filler is common to both.
 */
export function shouldIncludeStatus(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  if (FILLER_ONLY.test(q)) return false;
  if (ABOUT_ITSELF.test(q)) return false;
  return true;
}

/**
 * Whether a turn is worth retrieving the admin's docs and vault notes for.
 * shouldSearch minus its homelab exclusion: the web knows nothing about this
 * homelab, but the docs and the vault are mostly *about* it.
 */
export function worthRetrieving(query: string): boolean {
  const q = query.trim();
  return q.length >= 4 && shouldIncludeStatus(q);
}

/** Whether a user turn is worth spending a search on. */
export function shouldSearch(query: string): boolean {
  const q = query.trim();
  // Too short to be a real question -- "hey", "ok", a stray character.
  if (q.length < 4) return false;
  if (q.length > MAX_SEARCH_QUERY_CHARS) return false;
  if (NO_SEARCH_PATTERNS.some((re) => re.test(q))) return false;
  if (CAPABILITY_QUESTION.test(q) && q.split(/\s+/).length <= MAX_CAPABILITY_QUESTION_WORDS) {
    return false;
  }
  return true;
}

/**
 * Whether a question is about the admin's own career -- their resume, jobs,
 * experience, skills -- and so needs the whole resume rather than search
 * fragments of it. "Summarize my job experience" once got "your job history
 * isn't in anything I can see", because three keyword hits are not a resume.
 */
const CAREER_QUESTION =
  // Letter/digit lookarounds, not \b: \b treats "é" as a non-word character,
  // so "résumé?" never matched. A bare "cv" is left out -- it is an episode
  // code as often as a resume.
  /(?<![\p{L}\p{N}])(r[eé]sum[eé]s?|my cv|career|linkedin|cover letter|work history|employment|employers?|accomplish(ed|ments?)?|job (history|experience)|work experience|(my|his|jake'?s|jakob'?s) (jobs?|experience|skills|background|roles?|positions?|titles?|work)|where (have|did|do) i work(ed)?|worked (at|for)|(interview|apply|applying|application)s? (for|to|at))(?![\p{L}\p{N}])/iu;

export function isCareerQuestion(query: string): boolean {
  return CAREER_QUESTION.test(query);
}

export type IncomingMessage = { role?: unknown; content?: unknown };

/**
 * Builds the message list sent upstream.
 *
 * The system prompt is prepended here and only here. Client-supplied roles are
 * collapsed to user/assistant, so `{role: "system"}` from the browser arrives
 * as an ordinary user turn instead of new instructions. That matters more now
 * that one of the backends is metered: the browser picks which model answers,
 * so it must not also get to pick what that model is told to do.
 */
export function prepareChatMessages(
  incoming: unknown,
  systemPrompt: string = SYSTEM_PROMPT
): ChatMessage[] {
  const list = Array.isArray(incoming) ? incoming : [];

  const cleaned: ChatMessage[] = [];
  for (const raw of list as IncomingMessage[]) {
    const content = typeof raw?.content === "string" ? raw.content.trim() : "";
    if (!content) continue;
    cleaned.push({
      // Anything that isn't explicitly an assistant turn is treated as user
      // input -- including "system".
      role: raw?.role === "assistant" ? "assistant" : "user",
      content: content.slice(0, MAX_MESSAGE_CHARS),
    });
  }

  // Keep the most recent turns; the oldest are the ones the model would have
  // evicted anyway.
  const trimmed = cleaned.slice(-MAX_HISTORY_MESSAGES);

  return [{ role: "system", content: systemPrompt }, ...trimmed];
}

/** A request with nothing to answer -- the route rejects rather than calling out. */
export function hasUserTurn(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.role === "user");
}

/** The most recent user turn -- what a web search should be run against. */
export function latestUserQuery(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return null;
}

/**
 * Inserts a context block immediately before the final user turn, so the model
 * reads the question last -- small models weight the tail of the prompt
 * heavily, and burying the question above 5 search results loses it.
 *
 * Applying this twice (stack status, then search) leaves the question last
 * either way, which is the property that matters.
 */
export function withContext(
  messages: ChatMessage[],
  context: ChatMessage
): ChatMessage[] {
  const lastUser = messages.map((m) => m.role).lastIndexOf("user");
  if (lastUser === -1) return messages;
  return [...messages.slice(0, lastUser), context, ...messages.slice(lastUser)];
}

