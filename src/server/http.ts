import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getRepository, HttpError } from "./database";
import type { OperationalOrder, Role, User } from "../lib/operations";
import { createFixedSession, fixedAccount, fixedSessionUser, isFixedSession } from "./fixedAccounts";

export const COOKIE_NAME = "passcheck_session";
export function sessionToken(request: Request) {
  return (request.headers.get("cookie") ?? "").split(";").map(part => part.trim()).find(part => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
}
export function requireUser(request: Request, roles?: readonly Role[]): User {
  const token = sessionToken(request);
  if (!token) throw new HttpError(401, "Sign in to continue");
  const user = isFixedSession(token) ? fixedSessionUser(token) : getRepository().sessionUser(token);
  if (!user || (user.id.startsWith("demo-") && !demoEnabled())) throw new HttpError(401, "Sign in to continue");
  if (roles && !roles.includes(user.role)) throw new HttpError(403, "Your account cannot access this feature");
  return user;
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  // Next.js can normalize request.url to localhost even when the browser uses 127.0.0.1.
  // The browser's Host header is the authority it actually visited; JS cannot override Host.
  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.slice(0, -1);
  let supplied: URL;
  try { supplied = new URL(origin); } catch { throw new HttpError(403, "Cross-origin changes are not allowed"); }
  if (supplied.host !== host || supplied.protocol !== `${protocol}:` || !["http:", "https:"].includes(supplied.protocol)) throw new HttpError(403, "Cross-origin changes are not allowed");
}
export function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store", Vary: "Cookie" } }); }
export function errorResponse(error: unknown) {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  if (error instanceof ZodError) return json({ error: error.issues.map(issue => issue.message).join("; ") }, 400);
  if (error instanceof SyntaxError) return json({ error: "Invalid JSON" }, 400);
  console.error("PassCheck server failure", error instanceof Error ? error.message : "Unknown failure");
  return json({ error: "The server could not complete this request" }, 500);
}
export async function endpoint(request: Request, roles: readonly Role[] | undefined, fn: (user: User) => unknown | Promise<unknown>) {
  try { if (request.method !== "GET") checkOrigin(request); return json(await fn(requireUser(request, roles))); }
  catch (error) { return errorResponse(error); }
}
export async function body(request: Request, limit = 100_000): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > limit) throw new HttpError(413, "Request is too large");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Missing request body");
  let total = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; total += value.byteLength; if (total > limit) { void reader.cancel(); throw new HttpError(413, "Request is too large"); } chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}
export function withSession(request: Request, user: User) {
  const response = json({ user });
  response.cookies.set(COOKIE_NAME, fixedAccount(user.id) ? createFixedSession(user) : getRepository().session(user.id), { httpOnly: true, secure: process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:", sameSite: "strict", path: "/", maxAge: 8 * 60 * 60 });
  return response;
}
export function demoEnabled() { return process.env.NODE_ENV !== "production" && process.env.PASSCHECK_DEMO_MODE === "true"; }
export function projectOrder(user: User, order: OperationalOrder) {
  if (user.role === "MANAGER" || user.role === "WAITER") return order;
  const common = { id: order.id, source: order.source, fulfillment: order.fulfillment, status: order.status, revision: order.revision, createdAt: order.createdAt, updatedAt: order.updatedAt, items: order.items, totalCents: order.totalCents, tableNumber: order.tableNumber, readyAt: order.readyAt, pickedUpAt: order.pickedUpAt, completedAt: order.completedAt, cancelledAt: order.cancelledAt };
  if (user.role === "CUSTOMER") return common;
  if (user.role === "CHEF") return { ...common, notes: order.notes, startedAt: order.startedAt, cookedAt: order.cookedAt, chefId: order.chefId, chefName: order.chefName };
  return { ...common, driverId: order.driverId, driverName: order.driverName, handoffLocation: order.handoffLocation, pickupCode: order.pickupCode,
    deliveryAddress: order.driverId === user.id ? order.deliveryAddress : "Claim this delivery to see its address", contact: order.driverId === user.id ? order.contact : "", customerName: order.driverId === user.id ? order.customerName : "", packagingStartedAt: order.packagingStartedAt, packingConfirmedAt: order.packingConfirmedAt };
}
