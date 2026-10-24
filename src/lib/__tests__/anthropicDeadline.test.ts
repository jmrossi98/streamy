import { describe, expect, it, vi } from "vitest";

/**
 * 2026-10-24: timeoutMs is a deadline for the whole completeAnthropic call --
 * retries, pause_turn continuations and fallback models included. It used to
 * be per attempt, and a resume review given 211 s ran past its job's cap.
 */
const create = vi.fn();

vi.mock("../db", () => ({ prisma: {} }));
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class Fake extends orig.default {
    constructor(opts: ConstructorParameters<typeof orig.default>[0]) {
      super(opts);
      (this as unknown as { messages: unknown }).messages = { create };
    }
  }
  return { ...orig, default: Fake };
});

process.env.ANTHROPIC_API_KEY = "test-key";
const { completeAnthropic } = await import("../anthropic");

/** A request that only ends when its signal aborts, like a slow model. */
function hang(_params: unknown, opts: { signal?: AbortSignal }) {
  return new Promise((_resolve, reject) => {
    opts.signal?.addEventListener("abort", () => reject(new Error("Request was aborted.")));
  });
}

describe("completeAnthropic deadline", () => {
  it("passes one signal and stops every model at the deadline", async () => {
    create.mockReset().mockImplementation(hang);
    const started = Date.now();
    await expect(
      completeAnthropic([{ role: "user", content: "hi" }], { models: ["a", "b"], maxTokens: 10, timeoutMs: 150 })
    ).rejects.toThrow(/timed out after 0 s/);
    expect(Date.now() - started).toBeLessThan(2_000);
    // The second model is never tried once the budget is spent.
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("returns the answer when it comes in time", async () => {
    create.mockReset().mockResolvedValue({
      model: "claude-x",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "done" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await expect(
      completeAnthropic([{ role: "user", content: "hi" }], { models: ["a"], maxTokens: 10, timeoutMs: 5_000 })
    ).resolves.toEqual({ text: "done", model: "claude-x" });
  });
});
