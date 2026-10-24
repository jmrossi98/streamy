import { describe, it, expect } from "vitest";
import {
  DEFAULT_ANTHROPIC_MODEL,
  LLM_USE_IDS,
  defaultProviderFor,
  defaultRouting,
  isValidModelId,
  modelChainFor,
  normalizeRouting,
  parseModelList,
  parseUseList,
  resetUses,
  usesIn,
  resolveRoute,
  type RoutingEnv,
} from "../llmRoutingRules";

const env = (configured: Partial<Record<"openrouter" | "anthropic", boolean>>): RoutingEnv => ({
  configured: { openrouter: false, anthropic: false, ...configured },
  claude: {
    openrouter: ["anthropic/claude-sonnet-4.6", "anthropic/claude-sonnet-4.5"],
    anthropic: ["claude-opus-5-5", "claude-sonnet-5-5"],
  },
  open: ["deepseek/deepseek-v3.2"],
});

describe("defaultRouting", () => {
  // The point of the second provider: when the Anthropic key is there, the
  // Claude-tier jobs spend the credit it represents by default.
  it("routes Claude-tier uses to Anthropic when its key is set", () => {
    const routing = defaultRouting(env({ openrouter: true, anthropic: true }));
    expect(routing.chatClaude).toEqual({ provider: "anthropic", model: "claude-opus-5-5", fallbacks: ["claude-sonnet-5-5"] });
    expect(routing.resume.provider).toBe("anthropic");
    expect(routing.apply.provider).toBe("anthropic");
  });

  it("falls back to OpenRouter without an Anthropic key", () => {
    const routing = defaultRouting(env({ openrouter: true }));
    expect(routing.chatClaude).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4.6",
      fallbacks: ["anthropic/claude-sonnet-4.5"],
    });
  });

  // Anthropic has no open-weight models, so the "Open" button must never
  // resolve to one of theirs whatever keys are present.
  it("keeps the open-weight slot on OpenRouter regardless", () => {
    for (const e of [env({ anthropic: true }), env({ openrouter: true, anthropic: true }), env({})]) {
      expect(defaultRouting(e).chatOpen).toEqual({ provider: "openrouter", model: "deepseek/deepseek-v3.2", fallbacks: [] });
    }
  });

  it("still names a model with an empty env chain", () => {
    const e = { ...env({ anthropic: true }), claude: { openrouter: [], anthropic: [] }, open: [] };
    expect(defaultRouting(e).chatClaude.model).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(defaultRouting(e).chatOpen.model).toBeTruthy();
  });

  it("covers every use", () => {
    const routing = defaultRouting(env({ openrouter: true }));
    for (const use of LLM_USE_IDS) expect(routing[use].model).toBeTruthy();
  });
});

describe("defaultProviderFor", () => {
  it("names a provider even with nothing configured", () => {
    expect(defaultProviderFor("chatClaude", env({}))).toBe("anthropic");
    expect(defaultProviderFor("chatOpen", env({}))).toBe("openrouter");
  });
});

describe("normalizeRouting", () => {
  const defaults = defaultRouting(env({ openrouter: true, anthropic: true }));

  it("accepts a valid routing", () => {
    const saved = normalizeRouting(
      { resume: { provider: "openrouter", model: "anthropic/claude-opus-4.6", fallbacks: ["anthropic/claude-sonnet-4.6"] } },
      defaults
    );
    expect(saved.resume).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-opus-4.6",
      fallbacks: ["anthropic/claude-sonnet-4.6"],
    });
    // Untouched rows keep their defaults.
    expect(saved.chatClaude).toEqual(defaults.chatClaude);
  });

  // A row is all-or-nothing: a valid provider with a junk model must not
  // produce a half-repaired route pairing Anthropic with an OpenRouter id.
  it("resets a row whose model id is junk, and only that row", () => {
    const saved = normalizeRouting(
      {
        resume: { provider: "anthropic", model: "rm -rf /", fallbacks: [] },
        apply: { provider: "openrouter", model: "deepseek/deepseek-v3.2", fallbacks: [] },
      },
      defaults
    );
    expect(saved.resume).toEqual(defaults.resume);
    expect(saved.apply.model).toBe("deepseek/deepseek-v3.2");
  });

  // The body is form data; the open slot stays on OpenRouter whatever it says.
  it("refuses a provider the use does not allow", () => {
    const saved = normalizeRouting({ chatOpen: { provider: "anthropic", model: "claude-opus-5-5", fallbacks: [] } }, defaults);
    expect(saved.chatOpen).toEqual(defaults.chatOpen);
  });

  it("drops junk fallbacks and never repeats the head", () => {
    const saved = normalizeRouting(
      { apply: { provider: "anthropic", model: "claude-opus-5-5", fallbacks: ["claude-opus-5-5", "bad id", "claude-sonnet-5-5", "claude-sonnet-5-5"] } },
      defaults
    );
    expect(saved.apply.fallbacks).toEqual(["claude-sonnet-5-5"]);
  });

  it("tolerates garbage input", () => {
    for (const junk of [null, undefined, "x", 7, [], { chatClaude: "nope" }, { chatClaude: null }]) {
      expect(normalizeRouting(junk, defaults)).toEqual(defaults);
    }
  });
});

describe("isValidModelId", () => {
  it("accepts the ids both providers use", () => {
    for (const id of ["claude-opus-5-5", "anthropic/claude-sonnet-4.6", "deepseek/deepseek-v3.2:free", "qwen/qwen3-235b-a22b-2507"]) {
      expect(isValidModelId(id)).toBe(true);
    }
  });
  it("rejects spaces, empties and non-strings", () => {
    for (const bad of ["", " ", "a b", "/leading", 7, null, "x".repeat(121)]) {
      expect(isValidModelId(bad)).toBe(false);
    }
  });
});

describe("resolveRoute", () => {
  const route = { provider: "anthropic" as const, model: "claude-opus-5-5", fallbacks: [] };

  it("uses the saved route when its provider has a key", () => {
    expect(resolveRoute("resume", route, env({ anthropic: true }))).toEqual({ ...route, use: "resume", substituted: false });
  });

  // Model ids don't carry across vendors, so the substitute runs on the other
  // provider's default chain, and says so.
  it("substitutes the other configured provider on its defaults", () => {
    const resolved = resolveRoute("resume", route, env({ openrouter: true }));
    expect(resolved).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4.6",
      fallbacks: ["anthropic/claude-sonnet-4.5"],
      use: "resume",
      substituted: true,
    });
  });

  it("is null when nothing can answer", () => {
    expect(resolveRoute("resume", route, env({}))).toBeNull();
    // The open slot has no second provider to fall to.
    const open = { provider: "openrouter" as const, model: "deepseek/deepseek-v3.2", fallbacks: [] };
    expect(resolveRoute("chatOpen", open, env({ anthropic: true }))).toBeNull();
  });
});

describe("modelChainFor / parseModelList", () => {
  it("puts the head first and never repeats it", () => {
    expect(modelChainFor({ provider: "anthropic", model: "a", fallbacks: ["b", "a", "b", "c"] })).toEqual(["a", "b", "c"]);
  });
  it("splits a comma list and ignores blanks", () => {
    expect(parseModelList(" a, b ,,c ")).toEqual(["a", "b", "c"]);
    expect(parseModelList("")).toEqual([]);
  });
});

describe("where each use is edited (2026-10-24)", () => {
  it("puts the chat slots on the assistant and resume/apply on the Jobs tab", () => {
    expect(usesIn("assistant")).toEqual(["chatClaude", "chatOpen"]);
    expect(usesIn("jobs")).toEqual(["resume", "apply"]);
    expect([...usesIn("assistant"), ...usesIn("jobs")].sort()).toEqual([...LLM_USE_IDS].sort());
  });

  it("resets only the panel's own rows", () => {
    const defaults = defaultRouting(env({ anthropic: true }));
    const edited = {
      ...defaults,
      chatClaude: { provider: "anthropic" as const, model: "claude-haiku-5-5", fallbacks: [] },
      resume: { provider: "anthropic" as const, model: "claude-sonnet-5-5", fallbacks: [] },
    };
    const out = resetUses(edited, usesIn("jobs"), defaults);
    expect(out.resume).toEqual(defaults.resume);
    expect(out.chatClaude.model).toBe("claude-haiku-5-5");
  });

  it("keeps only real uses from a submitted list", () => {
    expect(parseUseList(["resume", "bogus", "apply"])).toEqual(["resume", "apply"]);
    expect(parseUseList("resume")).toEqual([]);
  });
});
