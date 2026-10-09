/**
 * Reading the assistant's reply back out of the stream it is sent in. Pure.
 *
 * The chat route pipes the model's answer straight to the browser as
 * newline-delimited JSON and, until now, kept none of it: the usage log held
 * what was asked and never what was said. That made "what did it tell me on
 * my phone on Tuesday" unanswerable. This collects the text as it passes so
 * the route can save it beside the prompt once the stream ends.
 */

/**
 * How much of a reply to keep. An investigation's answer with its command
 * output runs to a few thousand characters; this is several of those, and
 * still bounded so a runaway generation cannot become a database problem.
 */
export const REPLY_LOG_MAX = 20_000;

export type ReplyCollector = {
  /** Feed the next chunk of the response body, exactly as it is sent. */
  push(chunk: Uint8Array): void;
  /** Everything said so far, with any stream error appended. */
  text(): string;
};

export function createReplyCollector(): ReplyCollector {
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
  const errors: string[] = [];

  const take = (line: string) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line) as { message?: { content?: unknown }; error?: unknown };
      if (typeof parsed.error === "string" && parsed.error) errors.push(parsed.error);
      const piece = parsed.message?.content;
      if (typeof piece === "string" && reply.length < REPLY_LOG_MAX) reply += piece;
    } catch {
      // Not a line this format produces; the browser skips it too.
    }
  };

  return {
    push(chunk) {
      // A chunk can end mid-line, so the tail waits for the rest.
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(take);
    },
    text() {
      // The stream may end without a final newline.
      if (buffer) {
        take(buffer);
        buffer = "";
      }
      const said = reply.length > REPLY_LOG_MAX ? `${reply.slice(0, REPLY_LOG_MAX - 1)}…` : reply;
      return [said.trim(), ...errors.map(failureNote)].filter(Boolean).join("\n");
    },
  };
}

/** How a turn that produced an error instead of (or after) an answer is recorded. */
export function failureNote(message: string): string {
  return `[failed: ${message}]`;
}
