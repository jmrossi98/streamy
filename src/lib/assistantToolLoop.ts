/**
 * The admin assistant's look-then-answer loop: read-only diagnostics on
 * mediabox, web search, page fetches and single vault notes (read-only), then the streamed answer. One line
 * per lookup is streamed as it runs so a phone shows progress instead of a
 * spinner.
 *
 * Grew out of diagInvestigation.ts on 2026-10-24, when web search stopped
 * being a toggle that searched every message and became tools the model
 * calls itself. The protocol and its limits are in assistantToolRules.ts (web)
 * and diagRules.ts (commands); why diagnostics need no confirm tap is in
 * diagRules.ts. Actions that change anything still go through remediation.ts
 * and the skill runner, behind a tap -- nothing here can.
 */
import { logAudit } from "./auditLog";
import { getDiagCatalogue, isDiagConfigured, runDiagCommand } from "./diag";
import { LOCAL_HELP } from "./diagApiRules";
import { isLocalCommand, runLocalCommand } from "./diagLocal";
import { formatResults, investigationPrompt, MAX_COMMANDS_TOTAL, MAX_STEPS, progressLine, type CommandResult } from "./diagRules";
import {
  capNote,
  cleanNotePath,
  citationInstruction,
  FetchAllowList,
  formatFetchResult,
  formatNoteResult,
  formatSearchResult,
  noteProgressLine,
  notesToolPrompt,
  parseToolLines,
  remainingLine,
  sourcesFooter,
  UNTRUSTED_HEADER,
  urlsIn,
  webProgressLine,
  webToolsPrompt,
  type FetchToolResult,
  type NoteToolResult,
  type SearchToolResult,
  type ToolLimits,
} from "./assistantToolRules";
import { withContext } from "./chatLimits";
import { createReplyCollector } from "./chatTranscriptRules";
import { fetchPage } from "./fetchPage";
import type { ChatMessage } from "./ollama";
import { readVaultNote } from "./vault";
import { searchWeb } from "./webSearch";

/** How the loop talks to whichever model is answering. */
export type LoopBackend = {
  /** A short buffered reply: tool lines, or nothing worth keeping. */
  step(convo: ChatMessage[], signal: AbortSignal): Promise<string>;
  /** The answer, streamed as NDJSON in Ollama's shape. */
  answer(convo: ChatMessage[], signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
};

export type LoopOptions = {
  messages: ChatMessage[];
  backend: LoopBackend;
  /** Offer the mediabox diagnostics (remote backends, stack questions). */
  diag: boolean;
  /** Offer SEARCH/FETCH. */
  web: boolean;
  /** Offer NOTE: read one vault note, read-only. Only when the vault is configured. */
  notes?: boolean;
  /** "Always search": this query is searched before the model is asked anything. */
  forceSearch: string | null;
  limits: ToolLimits;
  actorName: string;
  signal: AbortSignal;
};

const encoder = new TextEncoder();
const line = (text: string) => encoder.encode(JSON.stringify({ message: { content: text } }) + "\n");

async function diagCatalogue(): Promise<string> {
  // Never empty: Streamy's own read-only commands need nothing from mediabox,
  // so the assistant can still investigate -- and say so -- when mediabox is
  // the thing that is down.
  const mediabox = isDiagConfigured() ? await getDiagCatalogue() : null;
  return mediabox
    ? `${mediabox}\n\n${LOCAL_HELP}`
    : `${LOCAL_HELP}\n\n(Commands on the mediabox server itself -- docker logs, journalctl, tailscale -- are unavailable right now: its diagnostics service is not configured or not answering. If mediabox being unreachable fits the problem, say so.)`;
}

async function runSearch(query: string): Promise<SearchToolResult> {
  try {
    const out = await searchWeb(query);
    return out.kind === "ok" ? { query, kind: "ok", results: out.results } : { query, kind: "resting", message: out.message };
  } catch (err) {
    return { query, kind: "error", message: `search failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function runAssistantTurn(opts: LoopOptions): Promise<ReadableStream<Uint8Array>> {
  const { backend, limits, signal, actorName } = opts;
  let convo = opts.messages;
  if (opts.diag) convo = withContext(convo, { role: "system", content: investigationPrompt(await diagCatalogue()) });
  if (opts.web) convo = withContext(convo, { role: "system", content: webToolsPrompt(limits) });
  if (opts.notes) convo = withContext(convo, { role: "system", content: notesToolPrompt(limits) });

  const allow = new FetchAllowList();
  for (const m of opts.messages) if (m.role === "user") allow.add(urlsIn(m.content));

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const fetched: string[] = [];
      const searched: string[] = [];
      let searches = 0;
      let fetches = 0;
      let commands = 0;
      let notes = 0;
      let lookedUp = false;

      const doSearch = async (query: string) => {
        searches++;
        const r = await runSearch(query);
        if (r.kind === "ok") {
          allow.add(r.results.map((x) => x.url));
          searched.push(...r.results.slice(0, 3).map((x) => x.url));
        }
        controller.enqueue(line(webProgressLine({ tool: "search", arg: query }, r.kind === "ok" && r.results.length > 0)));
        if (r.kind === "resting") controller.enqueue(line(`> ${r.message}\n`));
        return formatSearchResult(r);
      };

      const doFetch = async (url: string) => {
        fetches++;
        let r: FetchToolResult;
        if (!allow.has(url)) {
          r = { url, ok: false, error: "not fetched -- only URLs from search results, the admin's messages, or links on a page read this turn can be opened. SEARCH for it first." };
        } else {
          const page = await fetchPage(url, { maxChars: limits.pageChars, signal });
          if (page.ok) {
            allow.add(page.links);
            fetched.push(page.url);
            r = { url: page.url, ok: true, title: page.title, text: page.text };
          } else {
            r = { url, ok: false, error: page.error };
          }
        }
        controller.enqueue(line(webProgressLine({ tool: "fetch", arg: url }, r.ok)));
        void logAudit(actorName, "assistant.fetch", url.slice(0, 200), r.ok ? "ok" : r.error.slice(0, 120));
        return formatFetchResult(r);
      };

      const doNote = async (raw: string) => {
        notes++;
        const path = cleanNotePath(raw);
        let r: NoteToolResult;
        if (!path) {
          r = { path: raw.slice(0, 200), ok: false, error: "not a readable vault path -- it must be a relative .md path inside the vault, such as main/apple-notes/notes/Name.md" };
        } else {
          try {
            const { text, truncated } = capNote(await readVaultNote(path), limits.noteChars);
            r = { path, ok: true, text, truncated };
          } catch (err) {
            r = { path, ok: false, error: err instanceof Error ? err.message : String(err) };
          }
        }
        controller.enqueue(line(noteProgressLine(r.path, r.ok)));
        void logAudit(actorName, "assistant.note", r.path.slice(0, 200), r.ok ? "ok" : r.error.slice(0, 120));
        return formatNoteResult(r);
      };

      // Lookups that fail -- a model timing out on a step, mediabox dropping
      // off -- cost the lookups, never the answer: it is written from
      // whatever was gathered, and says the lookup stopped.
      try {
        if (opts.web && opts.forceSearch) {
          const block = await doSearch(opts.forceSearch);
          lookedUp = true;
          convo = [
            ...convo,
            { role: "assistant", content: `SEARCH: ${opts.forceSearch}` },
            { role: "user", content: `${UNTRUSTED_HEADER}\n\n${block}\n\n${remainingLine({ rounds: limits.rounds, searches: limits.searches - searches, fetches: limits.fetches - fetches, diag: opts.diag, notes: opts.notes ? limits.notes - notes : undefined })}` },
          ];
        }

        const rounds = opts.diag ? Math.max(MAX_STEPS, limits.rounds) : limits.rounds;
        for (let round = 0; round < rounds; round++) {
          if (signal.aborted) break;
          const reply = await backend.step(convo, signal);
          const requests = parseToolLines(reply, { diag: opts.diag && commands < MAX_COMMANDS_TOTAL, web: opts.web, notes: opts.notes });
          if (requests.length === 0) break;

          const blocks: string[] = [];
          const asked: string[] = [];
          const ran: CommandResult[] = [];
          for (const req of requests) {
            if (signal.aborted) break;
            if (req.tool === "run") {
              if (commands >= MAX_COMMANDS_TOTAL) continue;
              commands++;
              const result = isLocalCommand(req.arg) ? await runLocalCommand(req.arg) : await runDiagCommand(req.arg);
              ran.push(result);
              asked.push(`RUN: ${req.arg}`);
              controller.enqueue(line(progressLine(result)));
              void logAudit(actorName, "assistant.diag", req.arg, result.ok ? "ok" : result.output.slice(0, 120));
            } else if (req.tool === "search") {
              asked.push(`SEARCH: ${req.arg}`);
              blocks.push(searches < limits.searches ? await doSearch(req.arg) : `SEARCH: ${req.arg}\n(search limit for this turn reached)`);
            } else if (req.tool === "note") {
              asked.push(`NOTE: ${req.arg}`);
              blocks.push(notes < limits.notes ? await doNote(req.arg) : `NOTE: ${req.arg}\n(note limit for this turn reached)`);
            } else {
              asked.push(`FETCH: ${req.arg}`);
              blocks.push(fetches < limits.fetches ? await doFetch(req.arg) : `FETCH: ${req.arg}\n(fetch limit for this turn reached)`);
            }
          }
          if (asked.length === 0) break;
          lookedUp = true;
          const stepsLeft = rounds - round - 1;
          const parts = [UNTRUSTED_HEADER];
          if (ran.length > 0) parts.push(formatResults(ran, stepsLeft, MAX_COMMANDS_TOTAL - commands));
          parts.push(...blocks);
          parts.push(remainingLine({ rounds: stepsLeft, searches: limits.searches - searches, fetches: limits.fetches - fetches, diag: opts.diag && commands < MAX_COMMANDS_TOTAL, notes: opts.notes ? limits.notes - notes : undefined }));
          convo = [...convo, { role: "assistant", content: asked.join("\n") }, { role: "user", content: parts.join("\n\n") }];
        }
      } catch (err) {
        if (signal.aborted) return controller.close();
        const message = err instanceof Error ? err.message : String(err);
        console.error("[chat] lookup step failed:", message);
        controller.enqueue(line(`> the lookup stopped early: ${message}\n`));
        convo = [...convo, { role: "system", content: `The lookups stopped early (${message}). Answer from what you have and say what you could not check.` }];
        lookedUp = true;
      }

      try {
        if (signal.aborted) return controller.close();
        if (lookedUp) controller.enqueue(line("\n"));
        const usedWeb = fetched.length + searched.length > 0;
        const finalNote =
          "Answer the admin now, in prose. Do not write RUN, SEARCH, FETCH or NOTE lines." + (usedWeb ? ` ${citationInstruction()}` : "");
        const answer = await backend.answer([...convo, { role: "system", content: finalNote }], signal);
        const collector = createReplyCollector();
        const reader = answer.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          collector.push(value);
          controller.enqueue(value);
        }
        // A safety net, not the main path: the model is told to cite, and
        // usually does. When it didn't, the admin still sees where it looked.
        const footer = usedWeb && !signal.aborted ? sourcesFooter(collector.text(), fetched, searched) : "";
        if (footer) controller.enqueue(line(footer));
      } catch (err) {
        if (!signal.aborted) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[chat] answer failed:", message);
          controller.enqueue(line(`\n(The answer stopped early: ${message})`));
        }
      }
      controller.close();
    },
  });
}
