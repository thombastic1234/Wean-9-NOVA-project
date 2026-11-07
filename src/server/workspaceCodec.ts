import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { HttpError } from "./database";

const MAX_BYTES = 2 * 1024 * 1024;
const key = () => createHash("sha256").update(`passcheck-browser-workspace-v1:${process.env.PASSCHECK_SESSION_SECRET || "passcheck-public-demo-accounts-session-v1"}`).digest();
export function encodeWorkspace(value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > MAX_BYTES) throw new HttpError(413, "This browser demo is full. Reset the demo to start again.");
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}
export function decodeWorkspace(value: string): unknown {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > Math.ceil((MAX_BYTES + 28) * 4 / 3)) throw new Error("Invalid envelope");
    const bytes = Buffer.from(value, "base64url");
    if (bytes.length < 29 || bytes.toString("base64url") !== value) throw new Error("Invalid encoding");
    const cipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8"));
  } catch { throw new HttpError(409, "This browser demo could not be restored. A manager can reset this browser demo to start again."); }
}
