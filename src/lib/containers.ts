/**
 * Container-level state on mediabox, read through Portainer.
 *
 * This is the one question the service probes structurally cannot answer.
 * They ask each service's own API whether it is working, which is the better
 * signal for "is Jellyfin serving" -- but it says nothing about *why* when the
 * answer is no, and nothing at all about a container that exited, is
 * crash-looping, or is running with no network.
 *
 * Portainer rather than the Docker socket: the socket is root-equivalent on
 * mediabox and is not, and should not be, reachable across the network. A
 * scoped Portainer token is the difference between "Streamy can read container
 * state" and "Streamy can own the box".
 *
 * Read-only by construction. Nothing here calls anything but GET, so the worst
 * a compromised token can do from this code path is read a container list. The
 * chat reports what needs restarting; a human does the restarting in Portainer.
 */

const PROBE_TIMEOUT_MS = 6_000;

const env = (k: string) => process.env[k]?.replace(/\/$/, "") ?? "";

export type ContainerState = {
  /**
   * Full container id.
   *
   * Needed because `network_mode: container:<id>` references an id, not a
   * name, so detecting a stale binding means comparing ids.
   */
  id: string;
  name: string;
  /** Docker's own word: running, exited, restarting, paused, dead, created. */
  state: string;
  /** Human status line, e.g. "Up 3 hours (healthy)". */
  status: string;
  /** Docker health, when the image defines a HEALTHCHECK at all. */
  health: "healthy" | "unhealthy" | "starting" | "none";
  /**
   * The container whose network namespace this one shares, if any.
   *
   * `network_mode: service:gluetun` binds to a container *ID*, not a name, so
   * recreating gluetun leaves every dependent pinned to an ID that no longer
   * exists. They keep running, keep reporting healthy, and have no network.
   * This is what makes that detectable from outside the box.
   */
  networkMode: string;
};

export function isContainerViewConfigured(): boolean {
  return !!env("PORTAINER_URL") && !!process.env.PORTAINER_API_KEY;
}

/**
 * Portainer's numeric environment id, discovered rather than assumed.
 *
 * This used to be `PORTAINER_ENDPOINT_ID || "1"`, with a comment reading "1
 * unless more hosts were added". A host *was* added: the only environment on
 * this Portainer is id 2, named docker-prod. So every call asked for endpoint
 * 1, got a 404 ("Unable to find an environment with the specified identifier"),
 * and listContainers returned null -- which callers correctly render as "we
 * couldn't look", so the container view simply showed nothing and never said
 * why. Confirmed live 2026-09-19.
 *
 * A default that silently stops matching reality is worse than no default, so
 * this asks. The env var still wins when set, for a multi-host Portainer where
 * "the first one" is the wrong answer.
 *
 * Cached for the life of the process: endpoint ids are assigned when a host is
 * added and do not change under a running server.
 */
let cachedEndpointId: string | null = null;

async function endpointId(): Promise<string | null> {
  const configured = process.env.PORTAINER_ENDPOINT_ID?.trim();
  if (configured) return configured;
  if (cachedEndpointId) return cachedEndpointId;

  try {
    const res = await fetch(`${env("PORTAINER_URL")}/api/endpoints`, {
      headers: { "X-API-Key": process.env.PORTAINER_API_KEY ?? "" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!Array.isArray(body) || body.length === 0) return null;
    const id = (body[0] as { Id?: number }).Id;
    if (typeof id !== "number") return null;
    cachedEndpointId = String(id);
    return cachedEndpointId;
  } catch {
    return null;
  }
}

type RawContainer = {
  Id?: string;
  Names?: string[];
  State?: string;
  Status?: string;
  HostConfig?: { NetworkMode?: string };
};

/**
 * Every container and how it is doing.
 *
 * Returns null -- not an empty array -- when this can't be read, so callers can
 * distinguish "nothing is wrong" from "we couldn't look". Reporting an
 * unreachable Portainer as "no containers have problems" would be the same
 * class of mistake as reporting an unverifiable VPN as healthy.
 */
export async function listContainers(): Promise<ContainerState[] | null> {
  if (!isContainerViewConfigured()) return null;

  const ep = await endpointId();
  if (!ep) return null;

  const url =
    `${env("PORTAINER_URL")}/api/endpoints/${encodeURIComponent(ep)}` +
    `/docker/containers/json?all=true`;

  let raw: RawContainer[];
  try {
    const res = await fetch(url, {
      headers: { "X-API-Key": process.env.PORTAINER_API_KEY ?? "" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return null;
    raw = body as RawContainer[];
  } catch {
    return null;
  }

  return raw.map((c) => {
    const status = c.Status ?? "";
    // Docker exposes health only inside the status string on this endpoint
    // ("Up 2 hours (unhealthy)"), so it is parsed rather than read as a field.
    const health: ContainerState["health"] = /\(healthy\)/.test(status)
      ? "healthy"
      : /\(unhealthy\)/.test(status)
        ? "unhealthy"
        : /\(health: starting\)/.test(status)
          ? "starting"
          : "none";
    return {
      id: c.Id ?? "",
      // Docker prefixes container names with a slash.
      name: (c.Names?.[0] ?? "").replace(/^\//, ""),
      state: c.State ?? "unknown",
      status,
      health,
      networkMode: c.HostConfig?.NetworkMode ?? "",
    };
  });
}

/**
 * The ones worth mentioning without being asked.
 *
 * Deliberately narrow. A list of twenty healthy containers pushed into a 3B
 * model's context makes its answers worse, not better -- it tries to account
 * for all of them. Only genuine faults are surfaced.
 */
export function containerProblems(containers: ContainerState[]): ContainerState[] {
  return containers.filter(
    (c) => c.state !== "running" || c.health === "unhealthy"
  );
}

/**
 * Dependents whose namespace container no longer exists.
 *
 * `network_mode: container:<id>` pointing at an id that is not in the running
 * set is the silent-no-network failure: the container is up, its own
 * healthcheck may pass, and nothing it needs is reachable. Only detectable by
 * cross-referencing, which is why it gets its own function.
 */
export function staleNamespaceBindings(containers: ContainerState[]): ContainerState[] {
  const live = new Set(
    containers.filter((c) => c.state === "running").map((c) => c.id)
  );
  return containers.filter((c) => {
    const m = /^container:([0-9a-f]+)$/.exec(c.networkMode);
    return m ? !live.has(m[1]) : false;
  });
}
