"use client";

import { signOut } from "next-auth/react";

const CALLBACK = "/who-is-watching";

/**
 * JWT can reference a User row that no longer exists (DB reset, etc.).
 * If an API returns 401 after getValidSessionUserId, clear the session so the user can sign in again.
 */
export async function signOutIfStaleSession(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  await signOut({ callbackUrl: CALLBACK });
  return true;
}
