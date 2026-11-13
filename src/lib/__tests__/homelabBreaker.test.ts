import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHomelabFetch, offlineError, probeTcp } from "../homelabBreaker";
import { HOST_UP, type HostState } from "../homelabBreakerRules";

const HOME = "100.84.77.56";

function store(state: HostState = HOST_UP) {
  return { installed: true, targets: [{ host: HOME, port: 8096 }], hosts: new Map([[HOME, state]]) };
}

const connectTimeout = () =>
  new TypeError("fetch failed", { cause: Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" }) });

afterEach(() => vi.restoreAllMocks());

describe("createHomelabFetch", () => {
  it("passes requests elsewhere straight through", async () => {
    const res = new Response("ok");
    const inner = vi.fn().mockResolvedValue(res);
    const f = createHomelabFetch(inner as unknown as typeof fetch, store({ ...HOST_UP, down: true, since: 1 }));
    expect(await f("https://api.themoviedb.org/3/movie/1", { method: "GET" })).toBe(res);
    expect(inner).toHaveBeenCalledWith("https://api.themoviedb.org/3/movie/1", { method: "GET" });
  });

  it("fails a homelab request at once while the host is down, as a network error", async () => {
    const inner = vi.fn();
    const f = createHomelabFetch(inner as unknown as typeof fetch, store({ ...HOST_UP, down: true, since: 1 }));
    const err = await f(`http://${HOME}:8989/api/v3/series`).catch((e) => e);
    expect(inner).not.toHaveBeenCalled();
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toBe("fetch failed");
    expect(err.cause.code).toBe("HOMELAB_OFFLINE");
  });

  it("opens when a real request waits out a connect timeout", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = store();
    const inner = vi.fn().mockRejectedValue(connectTimeout());
    const f = createHomelabFetch(inner as unknown as typeof fetch, s, () => 1234);
    await expect(f(`http://${HOME}:8096/Sessions`)).rejects.toThrow("fetch failed");
    expect(s.hosts.get(HOME)).toMatchObject({ down: true, since: 1234, lastError: "UND_ERR_CONNECT_TIMEOUT" });
    // The next one doesn't wait.
    await expect(f(`http://${HOME}:8096/Sessions`)).rejects.toMatchObject({ cause: { code: "HOMELAB_OFFLINE" } });
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("stays closed when a service refuses or a caller times out", async () => {
    const s = store();
    const refused = new TypeError("fetch failed", { cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }) });
    const inner = vi
      .fn()
      .mockRejectedValueOnce(refused)
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    const f = createHomelabFetch(inner as unknown as typeof fetch, s);
    await expect(f(`http://${HOME}:8989/api`)).rejects.toBe(refused);
    await expect(f(`http://${HOME}:8989/api`)).rejects.toThrow("timed out");
    expect(s.hosts.get(HOME)?.down).toBe(false);
  });

  it("keeps the properties of the fetch it wraps (Next marks its own)", () => {
    const inner = Object.assign(vi.fn(), { __nextPatched: true });
    const f = createHomelabFetch(inner as unknown as typeof fetch, store()) as unknown as { __nextPatched?: boolean };
    expect(f.__nextPatched).toBe(true);
  });

  it("offlineError reads like undici's", () => {
    expect(offlineError(HOME)).toMatchObject({ message: "fetch failed", cause: { code: "HOMELAB_OFFLINE" } });
  });
});

describe("probeTcp", () => {
  it("is reachable when something accepts", async () => {
    const server = net.createServer((sock) => sock.destroy());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    try {
      expect(await probeTcp("127.0.0.1", port, 2000)).toEqual({ ok: true, error: null });
    } finally {
      server.close();
    }
  });

  it("is reachable when the machine refuses: it answered", async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    await new Promise<void>((r) => server.close(() => r()));
    expect(await probeTcp("127.0.0.1", port, 2000)).toEqual({ ok: true, error: "ECONNREFUSED" });
  });
});
