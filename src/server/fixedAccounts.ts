import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { User } from "../lib/operations";

// Requested public demo credentials. This file is imported by server code only.
export const FIXED_PASSWORD = "password";
export const FIXED_ACCOUNTS = (["MANAGER", "CUSTOMER", "WAITER", "CHEF", "DRIVER"] as const).map(role => ({
  username: role.toLowerCase(),
  user: { id: `fixed-${role.toLowerCase()}`, name: role.charAt(0) + role.slice(1).toLowerCase(), email: `${role.toLowerCase()}@passcheck.invalid`, role } satisfies User,
}));
const PREFIX = "fixed1.";
const SESSION_SECONDS = 8 * 60 * 60;
// The fallback is deliberately demo-only: everyone already knows all five passwords.
// An optional server secret stabilizes private signing across Vercel function instances.
const signingKey = () => process.env.PASSCHECK_SESSION_SECRET || "passcheck-public-demo-accounts-session-v1";
const sign = (payload: string) => createHmac("sha256", signingKey()).update(payload).digest("base64url");

export function fixedAccount(id: string) { return FIXED_ACCOUNTS.find(account => account.user.id === id)?.user; }
export function authenticateFixedAccount(username: string, password: string): User | undefined {
  const account = FIXED_ACCOUNTS.find(value => value.username === username.trim().toLowerCase());
  const supplied = Buffer.from(password); const expected = Buffer.from(FIXED_PASSWORD);
  return account && supplied.length === expected.length && timingSafeEqual(supplied, expected) ? { ...account.user } : undefined;
}
export function isFixedUsername(username: string) { return FIXED_ACCOUNTS.some(account => account.username === username.trim().toLowerCase()); }
export function isFixedSession(token?: string) { return Boolean(token?.startsWith(PREFIX)); }
export function createFixedSession(user: User, now = Date.now()): string {
  const account = fixedAccount(user.id);
  if (!account || account.role !== user.role) throw new Error("Unknown fixed account");
  const payload = Buffer.from(JSON.stringify({ id: account.id, expiresAt: Math.floor(now / 1000) + SESSION_SECONDS, nonce: randomBytes(16).toString("hex") })).toString("base64url");
  return `${PREFIX}${payload}.${sign(payload)}`;
}
export function fixedSessionUser(token?: string, now = Date.now()): User | undefined {
  if (!token || token.length > 1000 || !isFixedSession(token)) return;
  const parts = token.slice(PREFIX.length).split(".");
  if (parts.length !== 2) return;
  const [payload, signature] = parts;
  const expected = Buffer.from(sign(payload)); const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { id?: string; expiresAt?: number; nonce?: string };
    const seconds = Math.floor(now / 1000);
    if (!Number.isInteger(value.expiresAt) || value.expiresAt! <= seconds || value.expiresAt! > seconds + SESSION_SECONDS || typeof value.nonce !== "string" || !/^[a-f0-9]{32}$/.test(value.nonce)) return;
    const user = value.id ? fixedAccount(value.id) : undefined;
    return user ? { ...user } : undefined;
  } catch { return; }
}
