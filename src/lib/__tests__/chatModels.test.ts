import { describe, it, expect } from "vitest";
import {
  CHAT_BACKENDS,
  DEFAULT_BACKEND,
  backendById,
  isRemoteBackend,
  normalizeBackend,
} from "../chatModels";

describe("normalizeBackend", () => {
  it("accepts every declared backend", () => {
    for (const b of CHAT_BACKENDS) {
      expect(normalizeBackend(b.id)).toBe(b.id);
    }
  });

  // The browser picks the backend, and the browser is data. An unrecognised
  // value must not reach a provider as a model id, and must not silently land
  // on a metered backend either -- both are billing surprises.
  it("falls back to the free local default for anything unrecognised", () => {
    for (const junk of [undefined, null, "", "gpt-4", "openai", 7, {}, []]) {
      expect(normalizeBackend(junk)).toBe(DEFAULT_BACKEND);
    }
    expect(isRemoteBackend(DEFAULT_BACKEND)).toBe(false);
  });

  it("does not accept a backend id by prefix or case", () => {
    expect(normalizeBackend("Claude")).toBe(DEFAULT_BACKEND);
    expect(normalizeBackend("claude ")).toBe(DEFAULT_BACKEND);
    expect(normalizeBackend("loc")).toBe(DEFAULT_BACKEND);
  });
});

describe("isRemoteBackend", () => {
  it("marks only the OpenRouter-backed choices as remote", () => {
    expect(isRemoteBackend("local")).toBe(false);
    expect(isRemoteBackend("open")).toBe(true);
    expect(isRemoteBackend("claude")).toBe(true);
  });
});

describe("backendById", () => {
  it("returns the matching backend", () => {
    expect(backendById("claude").label).toBe("Claude");
    expect(backendById("local").provider).toBe("ollama");
    expect(backendById("open").provider).toBe("openrouter");
  });

  it("gives every backend a label and a hint for the picker", () => {
    for (const b of CHAT_BACKENDS) {
      expect(b.label.length).toBeGreaterThan(0);
      expect(b.hint.length).toBeGreaterThan(0);
    }
  });
});
