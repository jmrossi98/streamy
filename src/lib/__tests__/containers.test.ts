import { describe, it, expect } from "vitest";
import {
  containerProblems,
  demuxDockerLogs,
  staleNamespaceBindings,
  type ContainerState,
} from "../containers";

/** Builds one Docker log-multiplexing frame: 8-byte header + payload. */
function frame(streamType: 1 | 2, text: string): Uint8Array {
  const payload = new TextEncoder().encode(text);
  const out = new Uint8Array(8 + payload.length);
  out[0] = streamType;
  // Bytes 1-3 reserved (left zero); bytes 4-7 are the big-endian length.
  new DataView(out.buffer).setUint32(4, payload.length, false);
  out.set(payload, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

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

describe("demuxDockerLogs", () => {
  it("strips the 8-byte header from each frame", () => {
    const bytes = concat(frame(1, "line one\n"), frame(2, "line two\n"));
    expect(demuxDockerLogs(bytes)).toBe("line one\nline two\n");
  });

  it("joins many frames in order", () => {
    const bytes = concat(
      frame(1, "a\n"),
      frame(1, "b\n"),
      frame(2, "c\n")
    );
    expect(demuxDockerLogs(bytes)).toBe("a\nb\nc\n");
  });

  it("returns an empty string for an empty response", () => {
    expect(demuxDockerLogs(new Uint8Array(0))).toBe("");
  });

  it("falls back to plain text for a TTY container's unframed output", () => {
    // A container run with a TTY sends raw bytes, no framing -- byte 0 of
    // real log text is essentially never a valid stream-type byte (0-2), so
    // this is what tells the two apart.
    const bytes = new TextEncoder().encode("plain text, no framing\n");
    expect(demuxDockerLogs(bytes)).toBe("plain text, no framing\n");
  });

  it("stops rather than misreads once framing looks wrong", () => {
    // A truncated final frame (fewer bytes than its own declared length) --
    // decodes what it can up to that point rather than throwing or reading
    // past the end of the buffer.
    const good = frame(1, "complete line\n");
    const bad = new Uint8Array(8);
    bad[0] = 1;
    new DataView(bad.buffer).setUint32(4, 500, false); // Claims 500 bytes that don't exist.
    const bytes = concat(good, bad);
    expect(demuxDockerLogs(bytes)).toBe("complete line\n");
  });
});
