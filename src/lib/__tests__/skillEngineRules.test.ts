import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPENCODE_MODEL,
  DEFAULT_SKILL_ENGINE,
  engineProblem,
  engineText,
  isOpenCodeModel,
  normalizeEngines,
  normalizeSkillEngine,
  providerOf,
  type EnginesStatus,
} from "../skillEngineRules";

const ready: EnginesStatus = {
  default: "claude",
  claude: { ready: true },
  opencode: { ready: true, defaultModel: DEFAULT_OPENCODE_MODEL, providers: { anthropic: true, openrouter: false, ollama: true } },
};

describe("model ids", () => {
  it("accepts the three providers' shapes", () => {
    expect(isOpenCodeModel("anthropic/claude-sonnet-5-5")).toBe(true);
    expect(isOpenCodeModel("openrouter/deepseek/deepseek-v3.2")).toBe(true);
    expect(isOpenCodeModel("ollama/qwen3:4b-instruct-2507-q4_K_M")).toBe(true);
    expect(providerOf("openrouter/deepseek/deepseek-v3.2")).toBe("openrouter");
  });
  it("refuses other shapes", () => {
    for (const bad of ["", "claude-sonnet-5-5", "google/gemini", "anthropic/", "anthropic/with space", 3, null]) {
      expect(isOpenCodeModel(bad)).toBe(false);
    }
    expect(providerOf("nope")).toBeNull();
  });
});

describe("normalizeSkillEngine", () => {
  it("falls back to the defaults, never to a surprise engine", () => {
    expect(normalizeSkillEngine(null)).toEqual(DEFAULT_SKILL_ENGINE);
    expect(normalizeSkillEngine({ engine: "codex", model: "x" })).toEqual(DEFAULT_SKILL_ENGINE);
    expect(normalizeSkillEngine({ engine: "opencode", model: "bad" })).toEqual({ engine: "opencode", model: DEFAULT_OPENCODE_MODEL });
    expect(normalizeSkillEngine({ engine: "opencode", model: "ollama/qwen3:4b" })).toEqual({ engine: "opencode", model: "ollama/qwen3:4b" });
  });
});

describe("normalizeEngines", () => {
  it("coerces the runner's answer", () => {
    expect(normalizeEngines({ default: "opencode", claude: { ready: true }, opencode: { ready: true, defaultModel: "x", providers: { anthropic: true } } })).toEqual({
      default: "opencode",
      claude: { ready: true },
      opencode: { ready: true, defaultModel: DEFAULT_OPENCODE_MODEL, providers: { anthropic: true, openrouter: false, ollama: true } },
    });
    expect(normalizeEngines("junk")).toBeNull();
    expect(normalizeEngines({})?.claude.ready).toBe(false);
  });
});

describe("engineProblem", () => {
  it("says what stops the chosen engine", () => {
    expect(engineProblem({ engine: "claude", model: "x" }, ready)).toBeNull();
    expect(engineProblem({ engine: "claude", model: "x" }, { ...ready, claude: { ready: false } })).toMatch(/setup-token/);
    expect(engineProblem({ engine: "opencode", model: "anthropic/claude-sonnet-5-5" }, ready)).toBeNull();
    expect(engineProblem({ engine: "opencode", model: "openrouter/deepseek/deepseek-v3.2" }, ready)).toMatch(/OPENROUTER_API_KEY/);
    expect(engineProblem({ engine: "opencode", model: "ollama/qwen3:4b" }, ready)).toBeNull();
    expect(engineProblem({ engine: "opencode", model: "x" }, { ...ready, opencode: { ...ready.opencode, ready: false } })).toMatch(/isn't installed/);
    // the runner being unreachable is not a problem with the choice
    expect(engineProblem({ engine: "opencode", model: "openrouter/x" }, null)).toBeNull();
  });
});

describe("engineText", () => {
  it("names what ran", () => {
    expect(engineText("claude", null)).toBe("Claude Code");
    expect(engineText("opencode", "anthropic/claude-sonnet-5-5")).toBe("OpenCode · anthropic/claude-sonnet-5-5");
    expect(engineText("opencode", null)).toBe("OpenCode");
    expect(engineText(null)).toBe("");
  });
});
