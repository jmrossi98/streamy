import { describe, it, expect } from "vitest";
import {
  containerProblems,
  staleNamespaceBindings,
  type ContainerState,
} from "../containers";

function c(over: Partial<ContainerState> = {}): ContainerState {
  return {
    id: "a".repeat(64),
    name: "thing",
    state: "running",
    status: "Up 2 hours",
    health: "none",
    networkMode: "bridge",
    ...over,
  };
}

describe("containerProblems", () => {
  it("says nothing about a healthy stack", () => {
    expect(containerProblems([c(), c({ name: "other" })])).toEqual([]);
  });

  it("reports anything not running", () => {
    const found = containerProblems([
      c({ name: "ok" }),
      c({ name: "dead", state: "exited", status: "Exited (1) 5 minutes ago" }),
      c({ name: "looping", state: "restarting" }),
    ]);
    expect(found.map((x) => x.name)).toEqual(["dead", "looping"]);
  });

  it("reports a running container Docker calls unhealthy", () => {
    const found = containerProblems([c({ name: "sick", health: "unhealthy" })]);
    expect(found.map((x) => x.name)).toEqual(["sick"]);
  });

  it("does not report a container whose healthcheck is still starting", () => {
    // Starting is the normal first 30s of any container with a healthcheck.
    // Treating it as a fault would make every deploy look like an outage.
    expect(containerProblems([c({ health: "starting" })])).toEqual([]);
  });
});

describe("staleNamespaceBindings", () => {
  const GLUETUN = "b".repeat(64);

  it("finds a dependent bound to a container that no longer exists", () => {
    // The silent-no-network failure: qbittorrent is running, its healthcheck
    // may well pass, and it has no network at all.
    const found = staleNamespaceBindings([
      c({ name: "gluetun", id: GLUETUN }),
      c({ name: "qbittorrent", networkMode: "container:" + "c".repeat(64) }),
    ]);
    expect(found.map((x) => x.name)).toEqual(["qbittorrent"]);
  });

  it("accepts a dependent bound to a running container", () => {
    expect(
      staleNamespaceBindings([
        c({ name: "gluetun", id: GLUETUN }),
        c({ name: "qbittorrent", networkMode: "container:" + GLUETUN }),
      ])
    ).toEqual([]);
  });

  it("counts a binding to a stopped container as stale", () => {
    // Present in the list but not running is exactly as fatal as absent: the
    // namespace is gone either way.
    const found = staleNamespaceBindings([
      c({ name: "gluetun", id: GLUETUN, state: "exited" }),
      c({ name: "qbittorrent", networkMode: "container:" + GLUETUN }),
    ]);
    expect(found.map((x) => x.name)).toEqual(["qbittorrent"]);
  });

  it("ignores containers on a normal network", () => {
    expect(
      staleNamespaceBindings([
        c({ networkMode: "bridge" }),
        c({ name: "h", networkMode: "host" }),
        c({ name: "s", networkMode: "" }),
      ])
    ).toEqual([]);
  });

  it("ignores an unresolved service: reference", () => {
    // Compose writes `service:gluetun` before Docker resolves it to an id.
    // That is not a stale binding and must not be reported as one.
    expect(
      staleNamespaceBindings([c({ networkMode: "service:gluetun" })])
    ).toEqual([]);
  });
});
