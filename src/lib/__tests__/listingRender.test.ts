import { afterEach, describe, expect, it, vi } from "vitest";
import { renderListing } from "../listingRender";

const META = "https://www.metacareers.com/profile/job_details/1106176811795569";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("renderListing", () => {
  it("never calls the runner for a site off the allowlist", async () => {
    vi.stubEnv("SKILL_RUNNER_URL", "http://runner");
    vi.stubEnv("SKILL_RUNNER_TOKEN", "t");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await renderListing("https://example.com/job")).toHaveProperty("error");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("waits out a busy runner (409) and returns the render", async () => {
    vi.useFakeTimers();
    vi.stubEnv("SKILL_RUNNER_URL", "http://runner");
    vi.stubEnv("SKILL_RUNNER_TOKEN", "t");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "busy" }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: "Minimum Qualifications", ms: 7000 }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const p = renderListing(META);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await p).toEqual({ text: "Minimum Qualifications", ms: 7000 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a refusal", async () => {
    vi.stubEnv("SKILL_RUNNER_URL", "http://runner");
    vi.stubEnv("SKILL_RUNNER_TOKEN", "t");
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "redirected" }), { status: 422 }));
    vi.stubGlobal("fetch", fetch);
    expect(await renderListing(META)).toEqual({ error: "redirected" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
