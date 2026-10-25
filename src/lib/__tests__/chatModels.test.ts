import { describe, it, expect } from "vitest";
import {
  CHAT_BACKENDS,
  DEFAULT_BACKEND,
  FALLBACK_BACKEND,
  backendById,
  isChatBackendId,
  isRemoteBackend,
  normalizeBackend,
  pickBackend,
  routingUseFor,
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
  it("falls back to the free local model for anything unrecognised", () => {
    for (const junk of [undefined, null, "", "gpt-4", "openai", 7, {}, []]) {
      expect(normalizeBackend(junk)).toBe(FALLBACK_BACKEND);
    }
  });

  it("does not accept a backend id by prefix or case", () => {
    expect(normalizeBackend("Claude")).toBe(FALLBACK_BACKEND);
    expect(normalizeBackend("claude ")).toBe(FALLBACK_BACKEND);
    expect(normalizeBackend("loc")).toBe(FALLBACK_BACKEND);
  });
});

describe("backend defaults", () => {
  // The whole point of the hybrid: routine questions go to the cheap
  // open-weight model, not to the 3B one that answers them wrongly.
  it("opens the picker on the open-weight slot", () => {
    expect(DEFAULT_BACKEND).toBe("open");
  });

  // The regression this guards: making the *default* metered must not also
  // make the junk-input fallback metered. Only a person should be able to
  // choose to spend, and a malformed request is not a person.
  it("never resolves malformed input to a metered backend", () => {
    expect(isRemoteBackend(FALLBACK_BACKEND)).toBe(false);
    expect(isRemoteBackend(normalizeBackend("nonsense"))).toBe(false);
    expect(isRemoteBackend(normalizeBackend(undefined))).toBe(false);
  });
});

describe("isRemoteBackend", () => {
  it("marks only the cloud-backed choices as remote", () => {
    expect(isRemoteBackend("local")).toBe(false);
    expect(isRemoteBackend("open")).toBe(true);
    expect(isRemoteBackend("claude")).toBe(true);
  });
});

describe("backendById", () => {
  it("returns the matching backend", () => {
    expect(backendById("claude").label).toBe("Claude");
    expect(backendById("local").provider).toBe("ollama");
    expect(backendById("open").provider).toBe("cloud");
  });

  it("gives every backend a label and a hint for the picker", () => {
    for (const b of CHAT_BACKENDS) {
      expect(b.label.length).toBeGreaterThan(0);
      expect(b.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("isChatBackendId", () => {
  it("accepts the slots and refuses junk rather than coercing it", () => {
    for (const b of CHAT_BACKENDS) expect(isChatBackendId(b.id)).toBe(true);
    expect(isChatBackendId("gpt")).toBe(false);
    expect(isChatBackendId(undefined)).toBe(false);
  });
});

describe("routingUseFor", () => {
  it("maps the metered slots to their routing rows and the local card to none", () => {
    expect(routingUseFor("claude")).toBe("chatClaude");
    expect(routingUseFor("open")).toBe("chatOpen");
    expect(routingUseFor("local")).toBeNull();
  });
});

describe("pickBackend", () => {
  it("keeps the saved choice while it can answer", () => {
    expect(pickBackend("claude", () => true)).toBe("claude");
  });

  it("falls to the first slot that can answer", () => {
    expect(pickBackend("claude", (id) => id === "open")).toBe("open");
    expect(pickBackend("open", (id) => id === "local")).toBe("local");
  });

  it("stays on the saved choice when nothing can answer", () => {
    expect(pickBackend("claude", () => false)).toBe("claude");
  });
});
