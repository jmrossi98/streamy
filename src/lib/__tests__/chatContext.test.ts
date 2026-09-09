import { describe, it, expect } from "vitest";
import { buildStatusContext } from "../chatContext";
import type { ServiceStatus } from "../serviceStatus";

const svc = (
  name: string,
  state: ServiceStatus["state"],
  detail = "",
  group: ServiceStatus["group"] = "Media"
): ServiceStatus => ({ name, group, state, detail });

describe("buildStatusContext", () => {
  // The bug this whole module exists for: asked to summarise the stack, the
  // model explained it had no live access and listed `docker ps` for the admin
  // to run -- while Streamy was already probing all of it. The framing has to
  // say this is the model's own live view, or it disowns the block.
  it("frames the block as the model's own live view, not pasted input", () => {
    const msg = buildStatusContext([svc("Jellyfin", "up", "v10.9")]);
    expect(msg.role).toBe("system");
    expect(msg.content).toMatch(/live/i);
    expect(msg.content).toMatch(/probed just now|run seconds ago|your own live view/i);
  });

  it("tells the model not to claim it lacks access or ask for manual commands", () => {
    const content = buildStatusContext([svc("Jellyfin", "up")]).content;
    expect(content).toMatch(/do not tell the user you have no access/i);
    expect(content).toMatch(/run commands/i);
  });

  it("includes every service with its state and detail", () => {
    const content = buildStatusContext([
      svc("Jellyfin", "up", "v10.9.11"),
      svc("Radarr", "down", "connection refused"),
    ]).content;
    expect(content).toContain("Jellyfin");
    expect(content).toContain("v10.9.11");
    expect(content).toContain("Radarr");
    expect(content).toContain("connection refused");
    expect(content).toContain("[up]");
    expect(content).toContain("[down]");
  });

  // 22 alphabetised lines get summarised evenly; the point of asking is almost
  // always the one or two that are broken.
  it("sorts problems to the top and names them in the headline", () => {
    const content = buildStatusContext([
      svc("Alpha", "up"),
      svc("Zulu", "down", "timeout"),
      svc("Bravo", "unknown", "auth failed"),
    ]).content;

    expect(content).toMatch(/2 service\(s\) need attention/i);
    expect(content).toContain("Zulu");
    expect(content).toContain("Bravo");
    // Both problems appear before the healthy service in the body.
    expect(content.indexOf("- Zulu")).toBeLessThan(content.indexOf("- Alpha"));
    expect(content.indexOf("- Bravo")).toBeLessThan(content.indexOf("- Alpha"));
  });

  it("says so plainly when nothing is wrong", () => {
    const content = buildStatusContext([svc("Jellyfin", "up"), svc("Radarr", "up")]).content;
    expect(content).toMatch(/everything configured is reporting healthy/i);
    expect(content).not.toMatch(/need attention/i);
  });

  // "unknown" is a probe that couldn't run, not a verified failure. Collapsing
  // the two turns a stale password into a reported outage.
  it("explains the difference between down, unknown and unconfigured", () => {
    const content = buildStatusContext([svc("Radarr", "unknown", "auth failed")]).content;
    expect(content).toMatch(/unknown = the check could not run/i);
    expect(content).toMatch(/do not report this as an outage/i);
    expect(content).toMatch(/unconfigured = optional integration never set up/i);
  });

  // An integration nobody set up is not an outage, and the model needs to be
  // able to say "that isn't configured" rather than "that is down".
  it("keeps unconfigured services rather than hiding them", () => {
    const content = buildStatusContext([
      svc("Jellyfin", "up"),
      svc("Prowlarr", "unconfigured", "PROWLARR_URL unset"),
    ]).content;
    expect(content).toContain("Prowlarr");
    expect(content).toContain("[unconfigured]");
  });

  it("does not count unconfigured services as needing attention", () => {
    const content = buildStatusContext([
      svc("Prowlarr", "unconfigured"),
      svc("Gamarr", "unconfigured"),
    ]).content;
    expect(content).toMatch(/everything configured is reporting healthy/i);
  });

  it("survives an empty snapshot and a missing detail", () => {
    expect(() => buildStatusContext([])).not.toThrow();
    expect(buildStatusContext([])).toHaveProperty("role", "system");
    expect(buildStatusContext([svc("Thing", "up", "")]).content).toContain("no detail");
  });

  it("does not mutate the caller's array", () => {
    const input = [svc("Alpha", "up"), svc("Zulu", "down")];
    const before = input.map((s) => s.name);
    buildStatusContext(input);
    expect(input.map((s) => s.name)).toEqual(before);
  });
});
