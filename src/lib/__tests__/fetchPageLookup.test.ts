import { describe, expect, it, vi } from "vitest";

// A name that resolves to a private address -- the DNS-rebinding shape that
// checkUrl alone cannot see, since it only has the hostname.
const answers: Record<string, { address: string; family: number }[]> = {
  "rebind.example": [{ address: "100.84.77.56", family: 4 }],
  "mixed.example": [
    { address: "93.184.216.34", family: 4 },
    { address: "169.254.169.254", family: 4 },
  ],
  "public.example": [{ address: "93.184.216.34", family: 4 }],
};
vi.mock("node:dns", () => ({
  lookup: (host: string, _opts: object, cb: (e: Error | null, a: unknown) => void) => cb(null, answers[host] ?? []),
}));

const { guardedLookup } = await import("../fetchPage");

function resolve(host: string, all = false) {
  return new Promise<{ err: NodeJS.ErrnoException | null; address: unknown }>((done) =>
    guardedLookup(host, { all }, (err, address) => done({ err, address }))
  );
}

describe("guardedLookup", () => {
  it("refuses a public name that resolves to the tailnet", async () => {
    const r = await resolve("rebind.example");
    expect(r.err?.code).toBe("EBLOCKED");
  });

  it("refuses when any answer is private", async () => {
    expect((await resolve("mixed.example", true)).err?.code).toBe("EBLOCKED");
  });

  it("passes public answers through in the shape asked for", async () => {
    expect((await resolve("public.example")).address).toBe("93.184.216.34");
    expect((await resolve("public.example", true)).address).toEqual(answers["public.example"]);
  });
});
