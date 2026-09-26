"use client";

import { useState } from "react";

export type AdminAccount = {
  id: string;
  name: string;
  isAdmin: boolean;
  createdAt: string;
  /** The signed-in admin, who cannot delete themselves. */
  isSelf: boolean;
};

/**
 * Every approved account, with deletion.
 *
 * Deletion is gated behind typing the account name rather than a confirm
 * dialog. The cascade takes the person's watch history, watchlists, progress
 * and game saves with the row and none of it comes back, so the ceremony is
 * proportionate -- and unlike a dialog, it makes the admin read the name of
 * the row they are actually on.
 *
 * Pending signups are not here: they live in Pending approvals, where "deny"
 * already removes them, and an account that owns nothing needs none of this.
 */
export function AdminAccounts({ accounts }: { accounts: AdminAccount[] }) {
  const [rows, setRows] = useState(accounts);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function startConfirm(id: string) {
    setConfirmingId(id);
    setTyped("");
    setError(null);
  }

  async function remove(account: AdminAccount) {
    setBusyId(account.id);
    setError(null);
    try {
      const res = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: account.id, confirmName: typed }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== account.id));
      setConfirmingId(null);
      setTyped("");
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-white/60">No accounts.</p>;
  }

  return (
    <div className="space-y-3">
      <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
        {rows.map((account) => {
          const confirming = confirmingId === account.id;
          return (
            <li
              key={account.id}
              className="rounded-lg border border-white/10 bg-netflix-dark/80 px-4 py-3"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-white">
                    <span className="truncate">{account.name}</span>
                    {account.isAdmin && (
                      <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/60">
                        Admin
                      </span>
                    )}
                    {account.isSelf && (
                      <span className="shrink-0 text-xs text-white/40">(you)</span>
                    )}
                  </p>
                  <p className="text-xs text-white/50">
                    Joined {new Date(account.createdAt).toLocaleDateString()}
                  </p>
                </div>
                {!account.isSelf && !confirming && (
                  <button
                    type="button"
                    onClick={() => startConfirm(account.id)}
                    className="shrink-0 rounded border border-white/20 px-3 py-1.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
                  >
                    Delete
                  </button>
                )}
              </div>

              {confirming && (
                <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                  <p className="text-xs text-white/60">
                    Deletes {account.name}&rsquo;s watchlists, watch history and game saves
                    permanently. Their Jellyfin account, if they have one, is separate and
                    stays.
                  </p>
                  <label className="block text-xs text-white/50" htmlFor={`confirm-${account.id}`}>
                    Type <span className="font-medium text-white/80">{account.name}</span> to
                    confirm
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <input
                      id={`confirm-${account.id}`}
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      autoComplete="off"
                      className="min-w-0 flex-1 rounded border border-white/20 bg-black/40 px-3 py-1.5 text-sm text-white outline-none focus:border-white/40"
                    />
                    <button
                      type="button"
                      disabled={typed !== account.name || busyId === account.id}
                      onClick={() => void remove(account)}
                      className="shrink-0 rounded bg-netflix-red px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-netflix-red/90 disabled:opacity-40"
                    >
                      {busyId === account.id ? "Deleting…" : "Delete account"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      className="shrink-0 rounded border border-white/20 px-3 py-1.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="text-sm text-red-300">{error}</p>}
    </div>
  );
}
