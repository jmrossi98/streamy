/**
 * How each usenet provider reads in the admin panel. Pure.
 *
 * From SABnzbd's `mode=status` server list. A provider is down when SABnzbd
 * has an error against it (a refused login, too many connections) or it is
 * switched off; "no error" is the most that can be said of one that is idle,
 * because SABnzbd only connects while something is downloading.
 */

export type SabServer = {
  servername?: string;
  serveractive?: boolean;
  serveractiveconn?: number;
  servertotalconn?: number;
  servererror?: string;
};

export type UsenetProviderRow = { name: string; state: "up" | "down"; detail: string };

export function usenetProviderRows(servers: SabServer[]): UsenetProviderRow[] {
  if (servers.length === 0) {
    return [{ name: "Usenet providers", state: "down", detail: "No usenet provider is set up in SABnzbd" }];
  }
  return servers.map((s) => {
    const name = `Usenet: ${s.servername ?? "provider"}`;
    const error = (s.servererror ?? "").trim();
    if (error) return { name, state: "down", detail: error };
    if (s.serveractive === false) return { name, state: "down", detail: "Switched off in SABnzbd" };
    const inUse = s.serveractiveconn ?? 0;
    return {
      name,
      state: "up",
      detail:
        inUse > 0
          ? `Logged in, ${inUse} of ${s.servertotalconn ?? inUse} connections in use`
          : "No login error (idle, nothing downloading)",
    };
  });
}
