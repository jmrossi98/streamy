import { describe, it, expect } from "vitest";
import { filledValues, iptvUpdateMessage, isServerUrl, maskSecret, maskUsername, providerAlert } from "../credentialRules";

describe("maskSecret", () => {
  it("shows only the tail of a long key, and nothing of a short password", () => {
    expect(maskSecret("9293381158730c222f6097f93c380ee3")).toBe("set, ending 0ee3");
    expect(maskSecret("hunter2")).toBe("set");
    expect(maskSecret("")).toBe("not set");
    expect(maskSecret(null)).toBe("not set");
  });
});

describe("maskUsername", () => {
  it("keeps enough to recognise, not the whole", () => {
    expect(maskUsername("jakerossi")).toBe("ja…i");
    expect(maskUsername("ab")).toBe("a…");
  });
});

describe("filledValues", () => {
  it("drops blank and unknown fields so blank means leave as is", () => {
    expect(filledValues({ username: " new ", password: "", serverUrl: "   ", evil: "x" }, ["username", "password", "serverUrl"])).toEqual({
      username: "new",
    });
  });
});

describe("isServerUrl", () => {
  it("accepts http(s) with a host only", () => {
    expect(isServerUrl("http://line.provider.tv:8080")).toBe(true);
    expect(isServerUrl("https://x.example")).toBe(true);
    expect(isServerUrl("javascript:alert(1)")).toBe(false);
    expect(isServerUrl("not a url")).toBe(false);
  });
});

describe("providerAlert", () => {
  it("calls an expired login dead (trex, 2026-10-16)", () => {
    expect(providerAlert({ daysLeft: -1, detail: "Expired, 1 connection" })?.tone).toBe("danger");
    expect(providerAlert({ daysLeft: 3, detail: "Expired" })?.tone).toBe("danger");
  });
  it("warns shortly before, and when the check itself failed", () => {
    expect(providerAlert({ daysLeft: 2, detail: "1 connection" })?.text).toBe("Expires in 2 days.");
    expect(providerAlert({ daysLeft: null, problem: "timeout" })?.tone).toBe("warning");
  });
  it("says nothing about a healthy login or one it knows nothing about", () => {
    expect(providerAlert({ daysLeft: 30, detail: "1 connection" })).toBeNull();
    expect(providerAlert(undefined)).toBeNull();
  });
});

describe("iptvUpdateMessage", () => {
  it("reports what moved, a rejected login, or a slow refresh", () => {
    expect(iptvUpdateMessage({ refresh: "success", epgUpdated: 1, relinked: 34 })).toBe(
      "Saved and live: 34 channel streams moved to the new login, guide updated."
    );
    expect(iptvUpdateMessage({ refresh: "error", epgUpdated: 0, relinked: 0 })).toMatch(/rejected the new login/);
    expect(iptvUpdateMessage({ refresh: "timeout", epgUpdated: 0, relinked: 0 })).toMatch(/still refreshing/);
  });
});
