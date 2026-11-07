import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, canMarkReady, hasCompletedCheck, type Verification } from "../src/lib/contracts";
import { makeOrder, seedOrders } from "../src/lib/fixtures";
import { initialState, reducer, restoreState, serializeState, type State } from "../src/lib/store";

const now = Date.parse("2026-11-07T16:00:00Z");
const at = new Date(now).toISOString();
const orderId = "ON-1041";
function boot(): State { return reducer(initialState, { type: "hydrate", orders: seedOrders(now), settings: DEFAULT_SETTINGS }); }
function packing(): State {
  return reducer(reducer(boot(), { type: "start", orderId, at }), { type: "finish", orderId, at });
}
function verification(state: State, scanId = "scan-1", result: Verification["result"] = "manual_checked"): Verification {
  return { orderId, scanId, result, checkedAt: at, observed: state.orders.find(o => o.id === orderId)!.items.map(({ menuItemId, quantity }) => ({ menuItemId, quantity })), missing: [], extra: [], unknownItems: [], uncertainties: [] };
}
function checked(): State {
  const state = reducer(packing(), { type: "scan_started", orderId, scanId: "scan-1" });
  return reducer(state, { type: "verification", orderId, verification: verification(state) });
}
function confirmed(): State { return reducer(checked(), { type: "confirm_packing", orderId, confirmed: true, at }); }
function located(): State { return reducer(confirmed(), { type: "location", orderId, location: "Shelf A1" }); }

test("six relative-time fixtures contain both sources and no old checks", () => {
  const orders = seedOrders(now);
  assert.equal(orders.length, 6);
  assert.deepEqual(new Set(orders.map(o => o.source)), new Set(["waiter", "online"]));
  assert.equal(orders[0].createdAt, new Date(now - 12 * 60_000).toISOString());
  assert.ok(orders.every(o => o.status === "queued" && !o.verification && !o.packingConfirmedAt));
});

test("complete journey records timestamps, location and pickup code", () => {
  const state = located();
  const ready = reducer(state, { type: "ready", orderId, at });
  const order = ready.orders.find(o => o.id === orderId)!;
  assert.equal(order.status, "ready");
  for (const field of ["startedAt", "cookedAt", "readyAt", "packingConfirmedAt"] as const) assert.equal(order[field], at);
  assert.equal(order.handoffLocation, "Shelf A1");
  assert.equal(order.pickupCode, "PON1041");
  const collected = reducer(ready, { type: "collect", orderId, at });
  assert.equal(collected.orders.find(o => o.id === orderId)!.collectedAt, at);
  assert.equal(collected.orders.filter(o => o.status === "ready").length, 0);
});

test("queued orders cannot skip cooking or packing", () => {
  const state = boot();
  for (const type of ["finish", "ready", "collect"] as const) assert.equal(reducer(state, { type, orderId, at }), state);
  assert.equal(reducer(packing(), { type: "start", orderId, at }).orders.find(o => o.id === orderId)!.status, "packing");
});

test("cooking completion, check alone, or confirmation alone never makes ready", () => {
  for (const state of [packing(), checked(), confirmed()]) {
    assert.equal(canMarkReady(state.orders.find(o => o.id === orderId)!), false);
    assert.equal(reducer(state, { type: "ready", orderId, at }), state);
  }
  assert.equal(reducer(packing(), { type: "confirm_packing", orderId, confirmed: true, at }).orders.find(o => o.id === orderId)!.packingConfirmedAt, null);
});

test("wrong fulfillment location is rejected; table destination stays separate", () => {
  const state = confirmed();
  assert.equal(reducer(state, { type: "location", orderId, location: "Pass 1" }), state);
  const dineId = "IN-1042";
  const dine = reducer(reducer(boot(), { type: "start", orderId: dineId, at }), { type: "finish", orderId: dineId, at });
  const updated = reducer(dine, { type: "location", orderId: dineId, location: "Pass 2" });
  assert.equal(updated.orders.find(o => o.id === dineId)!.tableNumber, dine.orders.find(o => o.id === dineId)!.tableNumber);
  assert.equal(updated.orders.find(o => o.id === dineId)!.handoffLocation, "Pass 2");
});

test("ingestion deduplicates source/sourceOrderId and internal IDs", () => {
  const state = boot();
  assert.equal(reducer(state, { type: "ingest", order: { ...state.orders[0], id: "another-id" } }), state);
  assert.equal(reducer(state, { type: "ingest", order: { ...makeOrder("online", "9999", now), id: orderId } }), state);
  const next = reducer(state, { type: "ingest", order: makeOrder("waiter", "1041", now) });
  assert.equal(next.orders.length, 7);
});

test("stale scan and cross-order results do not replace current check", () => {
  const one = reducer(packing(), { type: "scan_started", orderId, scanId: "old" });
  const two = reducer(one, { type: "scan_started", orderId, scanId: "new" });
  assert.equal(reducer(two, { type: "verification", orderId, verification: verification(two, "old") }), two);
  assert.equal(reducer(two, { type: "verification", orderId, verification: { ...verification(two, "new"), orderId: "IN-1042" } }), two);
  const next = reducer(two, { type: "verification", orderId, verification: verification(two, "new") });
  assert.equal(next.orders.find(o => o.id === orderId)!.verification?.scanId, "new");
});

test("photo/check changes revoke check and packing confirmation", () => {
  const state = reducer(located(), { type: "scan_started", orderId, scanId: "new-photo" });
  const order = state.orders.find(o => o.id === orderId)!;
  assert.equal(order.verification, null);
  assert.equal(order.packingConfirmedAt, null);
  assert.equal(canMarkReady(order), false);
});

test("mismatch/review require correction or a fresh manual check", () => {
  for (const result of ["mismatch", "review_needed"] as const) {
    let state = reducer(packing(), { type: "scan_started", orderId, scanId: "scan-1" });
    state = reducer(state, { type: "verification", orderId, verification: verification(state, "scan-1", result) });
    assert.equal(hasCompletedCheck(state.orders.find(o => o.id === orderId)!), false);
    state = reducer(state, { type: "scan_started", orderId, scanId: "manual" });
    state = reducer(state, { type: "verification", orderId, verification: verification(state, "manual") });
    assert.equal(hasCompletedCheck(state.orders.find(o => o.id === orderId)!), true);
  }
});

test("a match with discrepancies, uncertainty, or incorrect counts cannot unlock readiness", () => {
  const state = checked();
  const order = state.orders.find(o => o.id === orderId)!;
  for (const change of [{ missing: [{ menuItemId: "burger" as const, quantity: 1 }] }, { unknownItems: ["unknown container"] }, { uncertainties: ["occluded"] }, { observed: [] }]) {
    assert.equal(hasCompletedCheck({ ...order, verification: { ...verification(state, "scan-1", "match"), ...change } }), false);
  }
});

test("late ranking, duplicate ranking IDs, and incomplete rankings are ignored", () => {
  const state = boot();
  const response = { requestVersion: state.priorityVersion, mode: "fallback" as const, ranking: state.orders.map(o => ({ orderId: o.id, reason: "demo" })) };
  assert.ok(reducer(state, { type: "ranking", response }).ranking);
  const changed = reducer(state, { type: "start", orderId, at });
  assert.equal(reducer(changed, { type: "ranking", response }), changed);
  assert.equal(reducer(state, { type: "ranking", response: { ...response, ranking: response.ranking.slice(1) } }), state);
  assert.equal(reducer(state, { type: "ranking", response: { ...response, ranking: response.ranking.map(() => response.ranking[0]) } }), state);
});

test("preferences and courier arrival invalidate priority responses", () => {
  const state = boot();
  const settings = reducer(state, { type: "settings", settings: { ...DEFAULT_SETTINGS, ageWeight: 8 } });
  assert.equal(settings.priorityVersion, state.priorityVersion + 1);
  const courier = reducer(state, { type: "courier", orderId: "ON-1045", at });
  assert.equal(courier.priorityVersion, state.priorityVersion + 1);
});

test("persistence restores authoritative state and ignores duplicate hydration", () => {
  const state = reducer(located(), { type: "ready", orderId, at });
  const restored = restoreState(serializeState(state));
  assert.deepEqual(restored.orders, state.orders);
  assert.deepEqual(restored.settings, state.settings);
  assert.equal(reducer(state, { type: "hydrate", orders: seedOrders(now + 999_999), settings: DEFAULT_SETTINGS }), state);
  assert.equal(reducer(initialState, { type: "ingest", order: makeOrder("waiter", "9999", now) }), initialState);
});

test("corrupt persistence and unchecked saved ready orders are rejected", () => {
  assert.throws(() => restoreState("broken"));
  const state = boot();
  assert.throws(() => restoreState(JSON.stringify({ version: 1, orders: [{ ...state.orders[0], status: "ready" }], settings: DEFAULT_SETTINGS })));
  assert.throws(() => restoreState(JSON.stringify({ version: 1, orders: [state.orders[0], state.orders[0]], settings: DEFAULT_SETTINGS })));
});

test("reset clears checks and rankings and uses fresh relative timestamps", () => {
  const state = located();
  const reset = reducer(state, { type: "reset", now: now + 3_600_000 });
  assert.equal(reset.ranking, null);
  assert.deepEqual(reset.latestScanIds, {});
  assert.deepEqual(reset.settings, DEFAULT_SETTINGS);
  assert.ok(reset.orders.every(o => !o.verification && !o.packingConfirmedAt && !o.handoffLocation));
  assert.equal(Date.parse(reset.orders[0].createdAt), now + 3_600_000 - 12 * 60_000);
  assert.ok(reset.priorityVersion > state.priorityVersion);
  assert.equal(reset.resetToken, state.resetToken + 1);
  const old = verification(state);
  assert.equal(reducer(reset, { type: "verification", orderId, verification: old }), reset);
});
