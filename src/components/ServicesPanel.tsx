import type { ServiceStatus, ServiceState } from "@/lib/serviceStatus";

// Colour is always paired with a text label, so state is never carried by
// colour alone.
const STATE_STYLE: Record<ServiceState, { dot: string; label: string; text: string }> = {
  up: { dot: "bg-emerald-500", label: "Up", text: "text-emerald-400" },
  down: { dot: "bg-red-500", label: "Down", text: "text-red-400" },
  unconfigured: { dot: "bg-white/25", label: "Off", text: "text-white/40" },
};

const GROUP_ORDER: ServiceStatus["group"][] = ["Media", "Downloads", "Assistant"];

export function ServicesPanel({ services }: { services: ServiceStatus[] }) {
  const down = services.filter((s) => s.state === "down");
  const up = services.filter((s) => s.state === "up").length;
  const configured = services.filter((s) => s.state !== "unconfigured").length;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full ${down.length ? "bg-red-500" : "bg-emerald-500"}`}
          aria-hidden
        />
        <span className={`text-sm font-medium ${down.length ? "text-red-400" : "text-emerald-400"}`}>
          {down.length ? `${down.length} service${down.length === 1 ? "" : "s"} down` : "All services up"}
        </span>
        <span className="text-xs text-white/30">
          {up}/{configured} configured
        </span>
      </div>

      {GROUP_ORDER.map((group) => {
        const inGroup = services.filter((s) => s.group === group);
        if (inGroup.length === 0) return null;

        return (
          <div key={group}>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/30">
              {group}
            </h3>
            <ul className="space-y-1.5">
              {inGroup.map((s) => {
                const style = STATE_STYLE[s.state];
                return (
                  <li
                    key={s.name}
                    className="flex items-center justify-between gap-3 rounded border border-white/10 bg-black/30 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden />
                      <span className="text-sm font-medium text-white">{s.name}</span>
                    </div>
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="truncate text-xs text-white/50">{s.detail}</span>
                      <span className={`shrink-0 text-xs font-medium ${style.text}`}>
                        {style.label}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
