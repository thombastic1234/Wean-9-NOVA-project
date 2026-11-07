import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRepository, HttpError } from "../src/server/database";
import { storageMode } from "../src/server/storageMode";
import { handleBrowserDemo } from "../src/server/browserDemo";
import { createFixedSession, FIXED_ACCOUNTS } from "../src/server/fixedAccounts";
import { decodeWorkspace, encodeWorkspace } from "../src/server/workspaceCodec";
import type { OperationalOrder, Role, Operation } from "../src/lib/operations";

process.env.VERCEL = "1"; process.env.PASSCHECK_STORAGE_MODE = "auto";
const forbiddenDirectory = join(mkdtempSync(join(tmpdir(), "passcheck-no-disk-")), "must-not-be-created");
process.env.PASSCHECK_DATABASE_PATH = join(forbiddenDirectory, "orders.sqlite");
const user = (role: Role) => FIXED_ACCOUNTS.find(account => account.user.role === role)!.user;
let workspace: string | null = null;
async function call(role: Role, path: string, method = "GET", data?: unknown) {
  const response = await handleBrowserDemo(new Request("https://passcheck.example/api/browser-demo", { method: "POST", headers: { Origin: "https://passcheck.example", "Content-Type": "application/json", cookie: `passcheck_session=${createFixedSession(user(role))}` }, body: JSON.stringify({ path, method, ...(data === undefined ? {} : { body: JSON.stringify(data) }), workspace }) }));
  const envelope = await response.json();
  if (response.ok) workspace = envelope.workspace;
  return { status: envelope.status ?? response.status, data: envelope.data ?? envelope };
}
async function action(order: OperationalOrder, operation: Operation, role: Role, payload = {}) {
  const response = await call(role, `/api/orders/${order.id}`, "PATCH", { action: operation, revision: order.revision, requestId: randomUUID(), ...payload });
  assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data.order as OperationalOrder;
}

test("Vercel auto-selects browser storage and never opens the configured application directory", async () => {
  assert.equal(storageMode(), "browser_demo");
  assert.throws(() => getRepository(), (error: unknown) => error instanceof HttpError && error.status === 503);
  const response = await call("MANAGER", "/api/orders"); assert.equal(response.status, 200); assert.deepEqual(response.data.orders, []);
  assert.equal(existsSync(forbiddenDirectory), false);
});
test("workspace encryption rejects corruption and exports no account credentials", () => {
  const encoded = encodeWorkspace({ version: 1, text: "private workspace" });
  assert.deepEqual(decodeWorkspace(encoded), { version: 1, text: "private workspace" });
  assert.ok(!encoded.includes("private workspace"));
  const bytes = Buffer.from(encoded, "base64url"); bytes[bytes.length - 1] ^= 1;
  assert.throws(() => decodeWorkspace(bytes.toString("base64url")), (error: unknown) => error instanceof HttpError && error.status === 409);
  assert.throws(() => decodeWorkspace("not-a-valid-workspace"));
  assert.throws(() => encodeWorkspace({ text: "x".repeat(2 * 1024 * 1024) }), (error: unknown) => error instanceof HttpError && error.status === 413);
  const state = decodeWorkspace(workspace!) as Record<string, unknown>;
  assert.equal(state.users, undefined); assert.equal(state.sessions, undefined); assert.equal(state.password_hash, undefined);
});
test("fresh request repositories preserve one browser's complete delivery workflow across role changes", async () => {
  const created = await call("CUSTOMER", "/api/orders", "POST", { requestId: randomUUID(), order: { source: "ONLINE", fulfillment: "DELIVERY", deliveryAddress: "123 Demo Street", items: [{ menuItemId: "burger", quantity: 1 }, { menuItemId: "milkshake", quantity: 1 }] } });
  assert.equal(created.status, 200); let order = created.data.order as OperationalOrder;
  const chefQueue = await call("CHEF", "/api/orders?source=ONLINE"); assert.equal(chefQueue.data.orders[0].id, order.id);
  const forbidden = await call("CUSTOMER", `/api/orders/${order.id}`, "PATCH", { action: "start_preparation", revision: 0, requestId: randomUUID() }); assert.equal(forbidden.status, 403);
  order = await action(order, "start_preparation", "CHEF"); order = await action(order, "finish_preparation", "CHEF");
  order = await action(order, "start_packaging", "WAITER"); order = await action(order, "scan_started", "WAITER", { scanId: "manual" });
  order = await action(order, "verification", "WAITER", { verification: { orderId: order.id, scanId: "manual", result: "manual_checked", checkedAt: new Date().toISOString(), observed: order.items.map(({ menuItemId, quantity }) => ({ menuItemId, quantity })), missing: [], extra: [], unknownItems: [], uncertainties: [] } });
  order = await action(order, "confirm_packing", "WAITER", { confirmed: true }); order = await action(order, "location", "WAITER", { location: "Shelf A1" });
  order = await action(order, "finish_packaging", "WAITER"); order = await action(order, "claim", "DRIVER"); order = await action(order, "pickup", "DRIVER");
  assert.equal(order.status, "OUT_FOR_DELIVERY"); assert.equal(order.completedAt, null);
  order = await action(order, "deliver", "DRIVER"); assert.equal(order.status, "COMPLETED");
  const customerView = await call("CUSTOMER", `/api/orders/${order.id}`); assert.equal(customerView.data.order.status, "COMPLETED"); assert.equal(customerView.data.order.history, undefined);
  const managerView = await call("MANAGER", `/api/orders/${order.id}`); assert.ok(managerView.data.order.history.some((entry: { action: string }) => entry.action === "pickup"));
  assert.equal(existsSync(forbiddenDirectory), false);
});
test("source filters, ownership and driver restrictions remain active in browser mode", async () => {
  const created = await call("WAITER", "/api/orders", "POST", { requestId: randomUUID(), order: { source: "IN_PERSON", fulfillment: "DINE_IN", tableNumber: "07", items: [{ menuItemId: "salad", quantity: 1 }] } }); assert.equal(created.status, 200);
  const id = created.data.order.id;
  assert.equal((await call("MANAGER", "/api/orders?source=IN_PERSON")).data.orders.length, 1);
  assert.equal((await call("CUSTOMER", `/api/orders/${id}`)).status, 404);
  assert.equal((await call("DRIVER", `/api/orders/${id}`)).status, 404);
  assert.equal((await call("CUSTOMER", "/api/users")).status, 403);
  assert.equal((await call("MANAGER", "/api/session", "POST", {})).status, 400, "the proxy cannot be used to sign in as another account");
  const preserved = workspace; workspace = null;
  assert.deepEqual((await call("MANAGER", "/api/orders")).data.orders, [], "another browser has a separate workspace");
  workspace = preserved;
  assert.equal((await call("MANAGER", "/api/orders")).data.orders.length, 2);
});
