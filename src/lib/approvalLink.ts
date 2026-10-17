/**
 * A one-click "approve this account" link, emailed to the admin when someone
 * signs up (Jake, 2026-10-17).
 *
 * The link carries the account's id and an expiry, signed with
 * NEXTAUTH_SECRET. Whoever holds the email can approve that one pending
 * account until the link expires, and nothing else: approving an account
 * twice does nothing, and a denied account no longer exists to approve.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const APPROVAL_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`approve-account:${payload}`).digest("base64url");
}

export function makeApprovalToken(userId: string, secret: string, now = Date.now()): string {
  const payload = `${userId}.${now + APPROVAL_LINK_TTL_MS}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** The account id the token approves, or null when it is forged, malformed or expired. */
export function readApprovalToken(token: string, secret: string, now = Date.now()): string | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !secret) return null;
  const [userId, exp, mac] = parts;
  const expected = sign(`${userId}.${exp}`, secret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!/^\d+$/.test(exp) || Number(exp) < now) return null;
  return userId || null;
}

export function approvalLinkUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/approvals/accept?token=${encodeURIComponent(token)}`;
}
