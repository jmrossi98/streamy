/** What a panel shows while its own data is still being read. */
export function PanelWaiting({ label }: { label: string }) {
  return <p className="py-4 text-sm text-white/30">{label}</p>;
}
