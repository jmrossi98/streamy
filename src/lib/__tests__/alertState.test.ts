import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The SNS client is stubbed so these tests exercise the decision logic --
// when to email and what to say -- without touching AWS.
const sent: { Subject: string; Message: string }[] = [];
vi.mock("@aws-sdk/client-sns", () => ({
  SNSClient: class {
    async send(cmd: { input: { Subject: string; Message: string } }) {
      sent.push({ Subject: cmd.input.Subject, Message: cmd.input.Message });
    }
  },
  PublishCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

let dir: string;
let statePath: string;

async function load() {
  // Re-imported per test so the module re-reads env.
  vi.resetModules();
  return import("../../../scripts/alert.mjs");
}

const failure = (name: string) => ({ name, detail: "something is wrong" });

beforeEach(async () => {
  sent.length = 0;
  dir = await mkdtemp(join(tmpdir(), "alert-"));
  statePath = join(dir, "state.json");
  vi.stubEnv("ALERT_SNS_TOPIC_ARN", "arn:aws:sns:us-east-1:1234:infra-alerts");
  vi.stubEnv("ALERT_PROJECT", "streamy");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe("alertOnStateChange", () => {
  it("emails when a healthy system starts failing", async () => {
    const { alertOnStateChange } = await load();
    await alertOnStateChange({
      statePath,
      failures: [failure("VPN isolation")],
      summary: "1 failed",
      host: "mediabox",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].Subject).toContain("[ALERT]");
    expect(sent[0].Subject).toContain("streamy");
    expect(sent[0].Message).toContain("VPN isolation");
  });

  // The whole point of tracking state: a check running every six hours that
  // emails on each failing run sends ~28 emails during one bad week.
  it("stays quiet while the same failure persists", async () => {
    const { alertOnStateChange } = await load();
    const args = {
      statePath,
      failures: [failure("VPN isolation")],
      summary: "1 failed",
      host: "mediabox",
    };
    await alertOnStateChange(args);
    await alertOnStateChange(args);
    await alertOnStateChange(args);
    expect(sent).toHaveLength(1);
  });

  it("emails again when a new failure joins an existing outage", async () => {
    const { alertOnStateChange } = await load();
    await alertOnStateChange({
      statePath,
      failures: [failure("VPN isolation")],
      summary: "1 failed",
      host: "mediabox",
    });
    await alertOnStateChange({
      statePath,
      failures: [failure("VPN isolation"), failure("Radarr download client")],
      summary: "2 failed",
      host: "mediabox",
    });
    expect(sent).toHaveLength(2);
    expect(sent[1].Message).toContain("Radarr download client");
  });

  it("emails a recovery when failures clear", async () => {
    const { alertOnStateChange } = await load();
    await alertOnStateChange({
      statePath,
      failures: [failure("VPN isolation")],
      summary: "1 failed",
      host: "mediabox",
    });
    await alertOnStateChange({ statePath, failures: [], summary: "all passed", host: "mediabox" });
    expect(sent).toHaveLength(2);
    expect(sent[1].Subject).toContain("[RESOLVED]");
    expect(sent[1].Message).toContain("VPN isolation");
  });

  it("stays quiet on a healthy run when nothing was wrong before", async () => {
    const { alertOnStateChange } = await load();
    await alertOnStateChange({ statePath, failures: [], summary: "all passed", host: "mediabox" });
    await alertOnStateChange({ statePath, failures: [], summary: "all passed", host: "mediabox" });
    expect(sent).toHaveLength(0);
  });

  it("does not announce a recovery on the very first run", async () => {
    // A missing state file must read as healthy, not as "was failing".
    const { alertOnStateChange } = await load();
    await alertOnStateChange({ statePath, failures: [], summary: "all passed", host: "mediabox" });
    expect(sent).toHaveLength(0);
  });

  it("treats the same failures in a different order as unchanged", async () => {
    const { alertOnStateChange } = await load();
    await alertOnStateChange({
      statePath,
      failures: [failure("a"), failure("b")],
      summary: "2 failed",
      host: "h",
    });
    await alertOnStateChange({
      statePath,
      failures: [failure("b"), failure("a")],
      summary: "2 failed",
      host: "h",
    });
    expect(sent).toHaveLength(1);
  });

  it("recovers cleanly from a corrupt state file", async () => {
    await writeFile(statePath, "{ not json", "utf8");
    const { alertOnStateChange } = await load();
    await alertOnStateChange({
      statePath,
      failures: [failure("VPN isolation")],
      summary: "1 failed",
      host: "h",
    });
    expect(sent).toHaveLength(1);
    // And leaves valid state behind for next time.
    expect(JSON.parse(await readFile(statePath, "utf8")).failing).toBe(true);
  });

  it("does nothing when no topic is configured", async () => {
    vi.stubEnv("ALERT_SNS_TOPIC_ARN", "");
    const { alertOnStateChange } = await load();
    const outcome = await alertOnStateChange({
      statePath,
      failures: [failure("VPN isolation")],
      summary: "1 failed",
      host: "h",
    });
    expect(sent).toHaveLength(0);
    expect(outcome).toMatch(/not configured/i);
  });

  it("keeps the SNS subject within its 100-character limit", async () => {
    vi.stubEnv("ALERT_PROJECT", "x".repeat(200));
    const { alertOnStateChange } = await load();
    await alertOnStateChange({
      statePath,
      failures: [failure("VPN isolation")],
      summary: "1 failed",
      host: "h",
    });
    expect(sent[0].Subject.length).toBeLessThanOrEqual(100);
  });
});
