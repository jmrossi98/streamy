import { describe, it, expect } from "vitest";
import { EMPTY_WATCH, servicesVerdict, watchServices } from "../serviceWatchRules";

const up = (name: string) => ({ name, state: "up", detail: "v1" });
const down = (name: string) => ({ name, state: "down", detail: "timeout" });

describe("watching services between panel visits", () => {
  it("does not alert on one failed check", () => {
    const first = watchServices(EMPTY_WATCH, [down("Prowlarr"), up("Sonarr")]);
    expect(first.newlyDown).toEqual([]);
    expect(first.state.streaks).toEqual({ Prowlarr: 1 });
  });

  it("alerts once a service is down on consecutive checks, and only once", () => {
    const first = watchServices(EMPTY_WATCH, [down("Prowlarr")]);
    const second = watchServices(first.state, [down("Prowlarr")]);
    expect(second.newlyDown.map((s) => s.name)).toEqual(["Prowlarr"]);
    const third = watchServices(second.state, [down("Prowlarr")]);
    expect(third.newlyDown).toEqual([]);
  });

  it("a restart between checks is not an outage", () => {
    const first = watchServices(EMPTY_WATCH, [down("Dispatcharr")]);
    const second = watchServices(first.state, [up("Dispatcharr")]);
    const third = watchServices(second.state, [down("Dispatcharr")]);
    expect(third.newlyDown).toEqual([]);
  });

  it("says when an alerted service is back, and can alert for it again later", () => {
    let w = watchServices(EMPTY_WATCH, [down("Radarr")]);
    w = watchServices(w.state, [down("Radarr")]);
    w = watchServices(w.state, [up("Radarr")]);
    expect(w.recovered).toEqual(["Radarr"]);
    w = watchServices(w.state, [down("Radarr")]);
    w = watchServices(w.state, [down("Radarr")]);
    expect(w.newlyDown.map((s) => s.name)).toEqual(["Radarr"]);
  });

  it("a check that could not run neither starts nor ends an outage", () => {
    let w = watchServices(EMPTY_WATCH, [down("VPN")]);
    w = watchServices(w.state, [{ name: "VPN", state: "unknown", detail: "can't verify" }]);
    expect(w.state.streaks).toEqual({ VPN: 1 });
    w = watchServices(w.state, [down("VPN")]);
    expect(w.newlyDown.map((s) => s.name)).toEqual(["VPN"]);
  });
});

describe("the scheduled services probe", () => {
  it("passes when nothing was down twice", () => {
    expect(servicesVerdict([], 41)).toMatchObject({ status: "pass", detail: "41 services checked, none down" });
  });

  it("names each service that was", () => {
    const r = servicesVerdict([down("Prowlarr"), down("FlareSolverr")], 41);
    expect(r.status).toBe("fail");
    expect(r.detail).toBe("Prowlarr is down (timeout); FlareSolverr is down (timeout)");
  });

  it("skips when the check itself failed", () => {
    expect(servicesVerdict(null, 0).status).toBe("skip");
  });
});
