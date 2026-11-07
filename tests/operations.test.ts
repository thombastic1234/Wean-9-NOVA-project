import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Repository, HttpError } from "../src/server/database";
import { allowedActions, canViewRole, progressSteps, type OperationalOrder, type User, type Operation } from "../src/lib/operations";
import { projectOrder } from "../src/server/http";
import { makeOrder } from "../src/lib/fixtures";

function setup() {
  const repo = new Repository(":memory:");
  const accounts = Object.fromEntries((["MANAGER", "CUSTOMER", "WAITER", "CHEF", "DRIVER"] as const).map(role => [role, repo.createUser({ email: `${role.toLowerCase()}@example.test`, name: role, role, password: "test-only-password" })])) as Record<"MANAGER" | "CUSTOMER" | "WAITER" | "CHEF" | "DRIVER", User>;
  const other = repo.createUser({ email: "other@example.test", name: "Other customer", role: "CUSTOMER", password: "test-only-password" });
  const driver2 = repo.createUser({ email: "driver2@example.test", name: "Other driver", role: "DRIVER", password: "test-only-password" });
  const create = (fulfillment: OperationalOrder["fulfillment"] = "DELIVERY", user = accounts.CUSTOMER, source: OperationalOrder["source"] = "ONLINE") => repo.create(user, { source, fulfillment, tableNumber: "03", deliveryAddress: "123 Test Street", notes: "No onions", items: [{ menuItemId: "burger", quantity: 2, options: ["No cheese"], notes: "Well done" }, { menuItemId: "salad", quantity: 1 }] }, randomUUID());
  const act = (order: OperationalOrder, action: Operation, user = accounts.MANAGER, payload: object = {}) => repo.action(user, order.id, { action, revision: order.revision, requestId: randomUUID(), ...payload });
  const prepare = (order: OperationalOrder) => act(act(order, "start_preparation", accounts.CHEF), "finish_preparation", accounts.CHEF);
  const pack = (order: OperationalOrder) => {
    order = act(order, "start_packaging", accounts.WAITER);
    order = act(order, "scan_started", accounts.WAITER, { scanId: "manual" });
    order = act(order, "verification", accounts.WAITER, { verification: { orderId: order.id, scanId: "manual", result: "manual_checked", checkedAt: new Date().toISOString(), observed: order.items.map(({ menuItemId, quantity }) => ({ menuItemId, quantity })), missing: [], extra: [], unknownItems: [], uncertainties: [] } });
    order = act(order, "confirm_packing", accounts.WAITER, { confirmed: true });
    order = act(order, "location", accounts.WAITER, { location: "Shelf A2" });
    return act(order, "finish_packaging", accounts.WAITER);
  };
  return { repo, accounts, other, driver2, create, act, prepare, pack };
}
function forbidden(fn: () => unknown, code = 403) { assert.throws(fn, (err: unknown) => err instanceof HttpError && err.status === code); }

test("customer isolation and source/fulfillment filters use stored ownership and distinct fields", () => {
  const { repo, accounts, other, create } = setup();
  const mine = create("TAKEAWAY"); create("DELIVERY", other); const inPerson = create("TAKEAWAY", accounts.WAITER, "IN_PERSON");
  assert.equal(repo.list(accounts.CUSTOMER).length, 1);
  assert.equal(repo.list(accounts.CUSTOMER, { customerId: other.id })[0].id, mine.id);
  forbidden(() => repo.read(accounts.CUSTOMER, inPerson.id), 404);
  assert.equal(repo.list(accounts.MANAGER, { source: "IN_PERSON", fulfillment: "TAKEAWAY" })[0].id, inPerson.id);
  assert.equal(repo.list(accounts.MANAGER, { source: "ONLINE", fulfillment: "TAKEAWAY" })[0].id, mine.id);
  forbidden(() => repo.create(accounts.CUSTOMER, { source: "ONLINE", fulfillment: "TAKEAWAY", customerId: other.id, items: [{ menuItemId: "burger", quantity: 1 }] }, randomUUID()));
  forbidden(() => create("TAKEAWAY", accounts.CUSTOMER, "IN_PERSON"));
  forbidden(() => create("DELIVERY", accounts.WAITER, "ONLINE"));
});

test("dine-in goes from preparation to serving without packaging", () => {
  const { accounts, create, prepare, act } = setup(); let order = prepare(create("DINE_IN", accounts.WAITER, "IN_PERSON"));
  assert.equal(order.status, "READY_TO_SERVE"); assert.equal(order.packagingStartedAt, null);
  forbidden(() => act(order, "start_packaging", accounts.WAITER));
  order = act(order, "serve", accounts.WAITER);
  assert.equal(order.status, "COMPLETED"); assert.ok(order.completedAt);
  assert.deepEqual(order.history.map(entry => entry.newStatus), ["PLACED", "PREPARING", "READY_TO_SERVE", "COMPLETED"]);
  assert.equal(order.history[1].actorId, accounts.CHEF.id);
  assert.deepEqual(progressSteps(order), ["PLACED", "PREPARING", "READY_TO_SERVE", "COMPLETED"]);
});

test("takeaway requires preparation, packaging, valid counts, confirmation, and location", () => {
  const { accounts, create, prepare, pack, act } = setup(); let order = create("TAKEAWAY", accounts.WAITER, "IN_PERSON");
  forbidden(() => act(order, "start_packaging", accounts.WAITER));
  order = prepare(order); assert.equal(order.status, "READY_TO_PACKAGE");
  const packaging = act(order, "start_packaging", accounts.WAITER);
  forbidden(() => act(packaging, "finish_packaging", accounts.WAITER), 409);
  forbidden(() => act(packaging, "confirm_packing", accounts.WAITER, { confirmed: true }), 409);
  // A separate order exercises the complete path; no unchecked order becomes ready.
  order = pack(prepare(create("TAKEAWAY")));
  assert.equal(order.status, "READY_FOR_PICKUP"); assert.equal(order.handoffLocation, "Shelf A2"); assert.ok(order.pickupCode);
  forbidden(() => act(order, "pickup", accounts.DRIVER), 404);
  order = act(order, "collect", accounts.WAITER); assert.equal(order.status, "COMPLETED"); assert.ok(order.pickedUpAt);
});

test("delivery claim and assignment restrict pickup; pickup is separate from delivery", () => {
  const { repo, accounts, driver2, create, act, prepare, pack } = setup(); let order = create();
  assert.equal(repo.list(accounts.DRIVER).length, 1);
  order = act(order, "claim", accounts.DRIVER);
  forbidden(() => repo.read(driver2, order.id), 404);
  assert.equal(repo.list(driver2).length, 0);
  forbidden(() => act(order, "pickup", accounts.DRIVER));
  order = pack(prepare(order));
  forbidden(() => act(order, "pickup", driver2), 404);
  order = act(order, "pickup", accounts.DRIVER); assert.equal(order.status, "OUT_FOR_DELIVERY"); assert.ok(order.pickedUpAt); assert.equal(order.completedAt, null);
  assert.equal(order.history.at(-1)!.actorId, accounts.DRIVER.id);
  order = act(order, "deliver", accounts.DRIVER); assert.equal(order.status, "COMPLETED"); assert.ok(order.completedAt);
});

test("manager actions use the same validation and cancelled orders cannot proceed", () => {
  const { create, act, accounts } = setup(); const order = create();
  forbidden(() => act(order, "finish_preparation"));
  forbidden(() => act(order, "cancel"), 400);
  const cancelled = act(order, "cancel", accounts.MANAGER, { reason: "Customer requested cancellation" });
  assert.equal(cancelled.history.at(-1)!.note, "Customer requested cancellation");
  for (const action of ["start_preparation", "start_packaging", "claim", "pickup"] as const) forbidden(() => act(cancelled, action));
});

test("customers and wrong staff roles cannot perform operational transitions", () => {
  const { accounts, create, act } = setup(); const order = create();
  for (const role of ["CUSTOMER", "WAITER", "DRIVER"] as const) forbidden(() => act(order, "start_preparation", accounts[role]));
  assert.ok(canViewRole(accounts.MANAGER, "DRIVER")); assert.equal(canViewRole(accounts.CUSTOMER, "MANAGER"), false);
});

test("duplicate requests are idempotent, stale/concurrent revisions conflict, mismatched reuse is rejected", () => {
  const { repo, accounts, create } = setup(); const order = create();
  const action = { action: "start_preparation" as const, revision: order.revision, requestId: randomUUID() };
  const first = repo.action(accounts.CHEF, order.id, action);
  assert.deepEqual(repo.action(accounts.CHEF, order.id, action), first);
  assert.equal(repo.get(order.id)!.history.length, 2);
  forbidden(() => repo.action(accounts.CHEF, order.id, { ...action, requestId: randomUUID() }), 409);
  forbidden(() => repo.action(accounts.CHEF, order.id, { ...action, action: "finish_preparation" }), 409);
  const key = randomUUID(); const input = { source: "ONLINE", fulfillment: "TAKEAWAY", items: [{ menuItemId: "salad", quantity: 1 }] };
  assert.equal(repo.create(accounts.CUSTOMER, input, key).id, repo.create(accounts.CUSTOMER, input, key).id);
});

test("stale scans and forged live matches cannot enter authoritative state", () => {
  const { repo, accounts, create, act, prepare } = setup(); let order = act(prepare(create()), "start_packaging", accounts.WAITER);
  order = act(order, "scan_started", accounts.WAITER, { scanId: "first" });
  order = act(order, "scan_started", accounts.WAITER, { scanId: "second" });
  const result = { orderId: order.id, scanId: "first", result: "match", observed: order.items.map(({ menuItemId, quantity }) => ({ menuItemId, quantity })), missing: [], extra: [], unknownItems: [], uncertainties: [], checkedAt: new Date().toISOString() };
  forbidden(() => act(order, "verification", accounts.WAITER, { verification: result }), 409);
  forbidden(() => act(order, "verification", accounts.WAITER, { verification: { ...result, scanId: "second" } }));
  forbidden(() => repo.recordVision(accounts.WAITER, order.id, "first", result as never), 409);
  const saved = repo.recordVision(accounts.WAITER, order.id, "second", { ...result, scanId: "second" } as never);
  assert.equal(saved.verification!.result, "match");
});

test("customer/chef/driver responses redact staff records and other customers' details", () => {
  const { accounts, create } = setup(); const order = create();
  for (const role of ["CUSTOMER", "CHEF", "DRIVER"] as const) {
    const projected = projectOrder(accounts[role], order) as Record<string, unknown>;
    assert.equal(projected.history, undefined); assert.equal(projected.verification, undefined); assert.equal(projected.customerId, undefined); assert.equal(projected.createdBy, undefined);
  }
  assert.equal((projectOrder(accounts.CUSTOMER, order) as Record<string, unknown>).deliveryAddress, undefined);
  assert.match((projectOrder(accounts.DRIVER, order) as { deliveryAddress: string }).deliveryAddress, /Claim/);
});

test("passwords and sessions are hashed, sessions expire and logout revokes them", () => {
  const { repo, accounts } = setup(); const token = repo.session(accounts.CUSTOMER.id);
  assert.equal(repo.login(accounts.CUSTOMER.email, "test-only-password").id, accounts.CUSTOMER.id);
  assert.equal(repo.sessionUser(token)!.id, accounts.CUSTOMER.id);
  assert.notEqual(repo.db.prepare("SELECT token_hash FROM sessions").get()!.token_hash, token);
  assert.notEqual(repo.db.prepare("SELECT password_hash FROM users LIMIT 1").get()!.password_hash, "test-only-password");
  repo.logout(token); assert.equal(repo.sessionUser(token), undefined);
  const next = repo.session(accounts.CUSTOMER.id); repo.db.exec("UPDATE sessions SET expires_at=0"); assert.equal(repo.sessionUser(next), undefined);
  forbidden(() => repo.login(accounts.CUSTOMER.email, "incorrect"), 401);
});

test("file-backed orders, history and sessions survive reopening the database", () => {
  const file = join(mkdtempSync(join(tmpdir(), "passcheck-persistence-")), "orders.sqlite");
  const first = new Repository(file); const user = first.createUser({ email: "person@example.test", name: "Person", role: "CUSTOMER", password: "test-only-password" });
  const order = first.create(user, { source: "ONLINE", fulfillment: "TAKEAWAY", items: [{ menuItemId: "salad", quantity: 1 }] }, randomUUID()); const token = first.session(user.id); first.db.close();
  const second = new Repository(file); assert.equal(second.get(order.id)!.history.length, 1); assert.equal(second.sessionUser(token)!.id, user.id); second.db.close();
});

test("legacy import preserves known facts without inventing ownership, history, prices or delivery completion", () => {
  const { repo, accounts } = setup(); const legacy = { ...makeOrder("online", "1041"), status: "collected", collectedAt: new Date().toISOString() };
  assert.equal(repo.importLegacy(accounts.MANAGER, [legacy]), 1); assert.equal(repo.importLegacy(accounts.MANAGER, [legacy]), 0);
  const order = repo.get(legacy.id)!;
  assert.equal(order.status, "OUT_FOR_DELIVERY"); assert.equal(order.customerId, null); assert.equal(order.totalCents, null); assert.equal(order.items[0].unitPriceCents, null);
  assert.equal(order.completedAt, null); assert.equal(order.history.length, 1); assert.equal(order.createdAt, legacy.createdAt); assert.equal(repo.list(accounts.CUSTOMER).length, 0);
  forbidden(() => repo.importLegacy(accounts.CUSTOMER, [legacy]));
  const assigned = repo.action(accounts.MANAGER, order.id, { action: "associate_customer", revision: order.revision, requestId: randomUUID(), userId: accounts.CUSTOMER.id });
  assert.equal(repo.list(accounts.CUSTOMER)[0].id, assigned.id);
});
