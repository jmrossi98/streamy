"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { MIN_PASSWORD_LENGTH, MIN_ADMIN_PASSWORD_LENGTH } from "@/lib/passwordPolicy";

type Props = { isAdmin: boolean };

export function ChangePasswordForm({ isAdmin }: Props) {
  const minLength = isAdmin ? MIN_ADMIN_PASSWORD_LENGTH : MIN_PASSWORD_LENGTH;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // Checked here as well as on the server so the common typo is caught without
  // a round trip. The server remains the authority.
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("New passwords don't match.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        signOutRequired?: boolean;
      };

      if (!res.ok) {
        setError(data.error ?? "Couldn't change password.");
        return;
      }

      // Changing the password invalidates every session issued before now,
      // this one included -- so the only coherent next step is to sign in again.
      setDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => void signOut({ callbackUrl: "/login" }), 1600);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="rounded border border-green-500/30 bg-green-950/30 px-4 py-4">
        <p className="text-sm font-medium text-green-300">Password changed.</p>
        <p className="mt-1 text-sm text-white/60">
          Every device signed in with the old password has been signed out. Taking you to
          the sign-in page…
        </p>
      </div>
    );
  }

  const inputClass =
    "w-full rounded border border-white/15 bg-black/40 px-3 py-2 text-white " +
    "placeholder-white/30 focus:border-white/40 focus:outline-none";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="currentPassword" className="mb-1 block text-sm text-white/70">
          Current password
        </label>
        <input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="newPassword" className="mb-1 block text-sm text-white/70">
          New password
        </label>
        <input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={minLength}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className={inputClass}
          aria-describedby="newPasswordHint"
        />
        <p id="newPasswordHint" className="mt-1 text-xs text-white/40">
          At least {minLength} characters{isAdmin ? " for admin accounts" : ""}. Can&apos;t be
          your name or a common password.
        </p>
      </div>

      <div>
        <label htmlFor="confirmPassword" className="mb-1 block text-sm text-white/70">
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className={`${inputClass} ${mismatch ? "border-red-500/60" : ""}`}
        />
        {mismatch && <p className="mt-1 text-xs text-red-400">Passwords don&apos;t match.</p>}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving || mismatch}
        className="rounded bg-netflix-red px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
      >
        {saving ? "Changing…" : "Change password"}
      </button>

      <p className="text-xs text-white/40">
        Changing your password signs out every device, including this one.
      </p>
    </form>
  );
}
