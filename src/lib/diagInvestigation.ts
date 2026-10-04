/**
 * Runs the assistant's investigation and streams the result: one line per
 * command as it runs, then the answer. See diagRules.ts for the protocol and
 * why this needs no confirm tap.
 *
 * Remote backends only. The loop asks the model to choose commands and read
 * their output, several times over -- work the 4B local model does not do
 * reliably, and on the local card each round would take longer than looking
 * by hand.
 */
import { logAudit } from "./auditLog";
import { getDiagCatalogue, isDiagConfigured, runDiagCommand } from "./diag";
import { LOCAL_HELP } from "./diagApiRules";
import { isLocalCommand, runLocalCommand } from "./diagLocal";
import {
  formatResults,
  investigationPrompt,
  MAX_COMMANDS_TOTAL,
  MAX_STEPS,
  parseRunLines,
  progressLine,
  type CommandResult,
} from "./diagRules";
import { withContext } from "./chatLimits";
import type { ChatMessage } from "./ollama";
import { completeOpenRouter, streamOpenRouterChat } from "./openrouter";

/** Enough for a few RUN lines; the answer itself is streamed separately. */
const STEP_MAX_TOKENS = 300;
const STEP_TIMEOUT_MS = 60_000;

const encoder = new TextEncoder();
const line = (text: string) => encoder.encode(JSON.stringify({ message: { content: text } }) + "\n");

/**
 * Never null in practice: Streamy's own read-only commands (service APIs, its
 * own records) need nothing from mediabox, so there is always something to
 * look at. Mediabox's commands are offered only when its diagnostics service
 * is configured and answering -- which also means the assistant can still
 * investigate, and say so, when mediabox itself is the thing that is down.
 */
export async function investigateThenAnswer(
  messages: ChatMessage[],
  models: string[],
  actorName: string,
  signal: AbortSignal
): Promise<ReadableStream<Uint8Array> | null> {
  const mediabox = isDiagConfigured() ? await getDiagCatalogue() : null;
  const catalogue = mediabox
    ? `${mediabox}\n\n${LOCAL_HELP}`
    : `${LOCAL_HELP}\n\n(Commands on the mediabox server itself -- docker logs, journalctl, tailscale -- are unavailable right now: its diagnostics service is not configured or not answering. If mediabox being unreachable fits the problem, say so.)`;

  let convo = withContext(messages, { role: "system", content: investigationPrompt(catalogue) });

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let total = 0;
      try {
        for (let step = 0; step < MAX_STEPS && total < MAX_COMMANDS_TOTAL; step++) {
          if (signal.aborted) break;
          const { text } = await completeOpenRouter(convo, {
            models,
            maxTokens: STEP_MAX_TOKENS,
            timeoutMs: STEP_TIMEOUT_MS,
          });
          const commands = parseRunLines(text).slice(0, MAX_COMMANDS_TOTAL - total);
          // No commands asked for: it has what it needs (or needs nothing).
          if (commands.length === 0) break;

          const results: CommandResult[] = [];
          for (const command of commands) {
            if (signal.aborted) break;
            const result = isLocalCommand(command) ? await runLocalCommand(command) : await runDiagCommand(command);
            results.push(result);
            controller.enqueue(line(progressLine(result)));
            void logAudit(actorName, "assistant.diag", command, result.ok ? "ok" : result.output.slice(0, 120));
          }
          total += results.length;
          convo = [
            ...convo,
            { role: "assistant", content: commands.map((c) => `RUN: ${c}`).join("\n") },
            { role: "user", content: formatResults(results, MAX_STEPS - step - 1, MAX_COMMANDS_TOTAL - total) },
          ];
        }

        if (signal.aborted) return controller.close();
        if (total > 0) controller.enqueue(line("\n"));
        const answer = await streamOpenRouterChat(
          [...convo, { role: "system", content: "Answer the admin now, in prose. Do not write RUN lines." }],
          models,
          signal
        );
        const reader = answer.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch (err) {
        if (!signal.aborted) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[chat] investigation failed:", message);
          controller.enqueue(line(`\n(The investigation stopped early: ${message})`));
        }
      }
      controller.close();
    },
  });
}
