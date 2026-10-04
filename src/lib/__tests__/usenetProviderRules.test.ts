import { describe, it, expect } from "vitest";
import { usenetProviderRows } from "../usenetProviderRules";

describe("usenetProviderRows", () => {
  it("marks a provider whose login is refused as down, with SABnzbd's reason", () => {
    const rows = usenetProviderRows([
      {
        servername: "Newshosting",
        serveractive: false,
        servererror: "Failed login for server news.newshosting.com [502 Authentication Failed]",
      },
      { servername: "news.usenet.farm", serveractive: true, serveractiveconn: 40, servertotalconn: 40, servererror: "" },
    ]);
    expect(rows[0]).toMatchObject({ name: "Usenet: Newshosting", state: "down" });
    expect(rows[0].detail).toMatch(/502 Authentication Failed/);
    expect(rows[1]).toEqual({
      name: "Usenet: news.usenet.farm",
      state: "up",
      detail: "Logged in, 40 of 40 connections in use",
    });
  });

  it("does not claim an idle provider is logged in", () => {
    const [row] = usenetProviderRows([{ servername: "Newshosting", serveractive: true, serveractiveconn: 0, servererror: "" }]);
    expect(row.state).toBe("up");
    expect(row.detail).toMatch(/idle/);
  });

  it("reports a switched-off provider and an empty server list as down", () => {
    expect(usenetProviderRows([{ servername: "x", serveractive: false, servererror: "" }])[0].state).toBe("down");
    expect(usenetProviderRows([])[0].state).toBe("down");
  });
});
