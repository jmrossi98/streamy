import { describe, expect, it } from "vitest";
import { DispatcharrAuth, EXPIRY_MARGIN_MS, jwtExpiryMs, LOGIN_PATH, REFRESH_PATH } from "../dispatcharrAuth";

function jwt(expSec: number, tag = "x"): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256" })}.${b({ exp: expSec, tag })}.sig`;
}

type Call = { path: string; body: Record<string, unknown> };

function harness(handlers: Partial<Record<string, (body: Record<string, unknown>) => Response>>) {
  let now = 1_000_000_000_000;
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = url.replace("http://d", "");
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ path, body });
    const h = handlers[path];
    if (!h) throw new Error(`unexpected ${path}`);
    return h(body);
  }) as unknown as typeof fetch;
  const auth = new DispatcharrAuth({
    baseUrl: "http://d",
    username: "u",
    password: "p",
    timeoutMs: 1000,
    fetchImpl,
    now: () => now,
    log: () => {},
  });
  return { auth, calls, advance: (ms: number) => (now += ms), nowSec: () => Math.floor(now / 1000) };
}

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

describe("jwtExpiryMs", () => {
  it("reads exp in ms", () => expect(jwtExpiryMs(jwt(100))).toBe(100_000));
  it("is null for junk", () => {
    expect(jwtExpiryMs("nope")).toBeNull();
    expect(jwtExpiryMs(null)).toBeNull();
  });
});

describe("DispatcharrAuth", () => {
  it("logs in once, then reuses the token until near expiry, then refreshes instead of logging in", async () => {
    let n = 0;
    const h = harness({
      [LOGIN_PATH]: () => json({ access: jwt(h.nowSec() + 1800, "a0"), refresh: "R1" }),
      [REFRESH_PATH]: (b) => {
        expect(b).toEqual({ refresh: "R1" });
        return json({ access: jwt(h.nowSec() + 1800, `a${++n}`) });
      },
    });
    const first = await h.auth.token();
    expect(await h.auth.token()).toBe(first);
    h.advance(1800_000 - EXPIRY_MARGIN_MS + 1);
    const second = await h.auth.token();
    expect(second).not.toBe(first);
    expect(h.calls.map((c) => c.path)).toEqual([LOGIN_PATH, REFRESH_PATH]);
    expect(h.auth.stats).toEqual({ logins: 1, refreshes: 1 });
  });

  it("keeps a rotated refresh token", async () => {
    const seen: unknown[] = [];
    const h = harness({
      [LOGIN_PATH]: () => json({ access: jwt(h.nowSec() + 60), refresh: "R1" }),
      [REFRESH_PATH]: (b) => {
        seen.push(b.refresh);
        return json({ access: jwt(h.nowSec() + 60), refresh: `R${seen.length + 1}` });
      },
    });
    await h.auth.token();
    h.advance(60_000);
    await h.auth.token();
    h.advance(60_000);
    await h.auth.token();
    expect(seen).toEqual(["R1", "R2"]);
  });

  it("falls back to a full login when the refresh is refused", async () => {
    const h = harness({
      [LOGIN_PATH]: () => json({ access: jwt(h.nowSec() + 1800), refresh: "R" }),
      [REFRESH_PATH]: () => json({ detail: "Token is invalid or expired" }, 401),
    });
    await h.auth.token();
    h.advance(1800_000);
    expect(await h.auth.token()).toBeTruthy();
    expect(h.calls.map((c) => c.path)).toEqual([LOGIN_PATH, REFRESH_PATH, LOGIN_PATH]);
  });

  it("renews via refresh after a 401, and shares one renewal between concurrent callers", async () => {
    const h = harness({
      [LOGIN_PATH]: () => json({ access: jwt(h.nowSec() + 1800, "old"), refresh: "R" }),
      [REFRESH_PATH]: () => json({ access: jwt(h.nowSec() + 1800, "new") }),
    });
    const old = (await h.auth.token())!;
    const [a, b] = await Promise.all([h.auth.renewAfterRejection(old), h.auth.renewAfterRejection(old)]);
    expect(a).toBe(b);
    expect(a).not.toBe(old);
    expect(h.calls.map((c) => c.path)).toEqual([LOGIN_PATH, REFRESH_PATH]);
    // A caller that saw the old token rejected after the renewal reuses the new one.
    expect(await h.auth.renewAfterRejection(old)).toBe(a);
    expect(h.calls).toHaveLength(2);
  });

  it("backs off a throttled login for its Retry-After", async () => {
    const h = harness({
      [LOGIN_PATH]: () => new Response("{}", { status: 429, headers: { "retry-after": "30" } }),
    });
    expect(await h.auth.token()).toBeNull();
    expect(await h.auth.token()).toBeNull();
    expect(h.calls).toHaveLength(1);
    h.advance(31_000);
    await h.auth.token();
    expect(h.calls).toHaveLength(2);
  });
});
