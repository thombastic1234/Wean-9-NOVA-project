import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, priorityRequestSchema, type PriorityRequest } from "../src/lib/contracts";
import { makeOrder } from "../src/lib/fixtures";
import { applyMaximumWait, fallbackRanking, makePriorityRequest, priorityScore, PRIORITY_TIMEOUT_MS } from "../src/lib/priority";
import { requestPriority } from "../src/lib/priorityClient";
import { buildPriorityCompletion, prioritizeOrders } from "../src/lib/priorityService";
import { initialState, reducer } from "../src/lib/store";

export const priorityDemo: PriorityRequest = {
  requestVersion: 7, settings: DEFAULT_SETTINGS,
  orders: [
    { orderId: "D104", fulfillment: "delivery", ageMinutes: 12, minutesUntilTargetReady: 4, estimatedPrepMinutes: 6, courierWaitingMinutes: 3 },
    { orderId: "T021", fulfillment: "dine_in", ageMinutes: 8, minutesUntilTargetReady: 12, estimatedPrepMinutes: 5, courierWaitingMinutes: 0 },
    { orderId: "T018", fulfillment: "dine_in", ageMinutes: 22, minutesUntilTargetReady: 15, estimatedPrepMinutes: 5, courierWaitingMinutes: 0 },
  ],
};
const ids = (result: { ranking: { orderId: string }[] }) => result.ranking.map(row => row.orderId);
const aiRanking = ["T021", "D104", "T018"].map(orderId => ({ orderId, reason: "Supplied timing facts." }));
const completion = (value: unknown, finish_reason = "stop") => Response.json({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason }] });

test("demo ranks maximum-wait T018 first, then urgent D104 with slack explanation", () => {
  const original = structuredClone(priorityDemo);
  const result = fallbackRanking(priorityDemo);
  assert.deepEqual(ids(result), ["T018", "D104", "T021"]);
  assert.equal(result.mode, "fallback");
  assert.match(result.ranking[0].reason, /Maximum wait/);
  assert.match(result.ranking[1].reason, /slack -2.0m/);
  assert.equal(priorityScore(priorityDemo.orders[0], DEFAULT_SETTINGS), 8);
  assert.deepEqual(priorityDemo, original, "never mutates inputs");
});

test("each weight affects its own factor; durations clamp and contributions cap", () => {
  const order = priorityDemo.orders[0];
  const zero = { ...DEFAULT_SETTINGS, ageWeight: 0, urgencyWeight: 0, courierWeight: 0 };
  assert.equal(priorityScore(order, zero), 0);
  assert.equal(priorityScore(order, { ...zero, ageWeight: 10 }), 6);
  assert.equal(priorityScore(order, { ...zero, urgencyWeight: 10 }), 10);
  assert.equal(priorityScore(order, { ...zero, courierWeight: 10 }), 3);
  assert.equal(priorityScore({ ...order, ageMinutes: -5, courierWaitingMinutes: -4, minutesUntilTargetReady: 100 }, DEFAULT_SETTINGS), 0);
  assert.equal(priorityScore({ ...order, ageMinutes: 1000, courierWaitingMinutes: 1000 }, DEFAULT_SETTINGS), 12);
});

test("threshold includes exact max wait; ties use older age then stable ID", () => {
  const settings = { ...DEFAULT_SETTINGS, ageWeight: 0, urgencyWeight: 0, courierWeight: 0 };
  const orders = [
    { ...priorityDemo.orders[0], orderId: "B", ageMinutes: 2 },
    { ...priorityDemo.orders[0], orderId: "A", ageMinutes: 2 },
    { ...priorityDemo.orders[0], orderId: "Z", ageMinutes: 3 },
    { ...priorityDemo.orders[0], orderId: "MAX", ageMinutes: 20 },
    { ...priorityDemo.orders[0], orderId: "OLDER", ageMinutes: 25 },
  ];
  assert.deepEqual(ids(fallbackRanking({ ...priorityDemo, settings, orders })), ["OLDER", "MAX", "Z", "A", "B"]);
  assert.deepEqual(ids(fallbackRanking({ ...priorityDemo, settings, orders: orders.reverse() })), ["OLDER", "MAX", "Z", "A", "B"]);
  assert.deepEqual(ids({ ranking: applyMaximumWait({ ...priorityDemo, orders }, orders.map(order => ({ orderId: order.orderId, reason: "AI reason" }))) }).slice(0, 2), ["OLDER", "MAX"]);
});

test("request conversion sends only queued orders and computes clamped elapsed durations", () => {
  const now = Date.parse("2026-11-07T16:00:00Z");
  const future = { ...makeOrder("online", "1", now + 60_000), courierArrivedAt: new Date(now + 60_000).toISOString() };
  const request = makePriorityRequest([future, { ...future, id: "cooking", status: "cooking" }], DEFAULT_SETTINGS, 3, now);
  assert.equal(request.orders.length, 1);
  assert.equal(request.orders[0].ageMinutes, 0);
  assert.equal(request.orders[0].courierWaitingMinutes, 0);
  assert.equal(request.orders[0].minutesUntilTargetReady, 16);
});

test("priority input rejects duplicate/empty IDs, fractional weights, and invalid durations", () => {
  assert.equal(priorityRequestSchema.safeParse({ ...priorityDemo, orders: [priorityDemo.orders[0], priorityDemo.orders[0]] }).success, false);
  assert.equal(priorityRequestSchema.safeParse({ ...priorityDemo, settings: { ...DEFAULT_SETTINGS, ageWeight: 1.5 } }).success, false);
  for (const patch of [{ orderId: "" }, { ageMinutes: -1 }, { courierWaitingMinutes: -1 }, { estimatedPrepMinutes: 0 }, { minutesUntilTargetReady: Infinity }]) {
    assert.equal(priorityRequestSchema.safeParse({ ...priorityDemo, orders: [{ ...priorityDemo.orders[0], ...patch }] }).success, false);
  }
});

test("OpenRouter payload uses fixed model, strict JSON schema, all weights, and data-only records", () => {
  const body = buildPriorityCompletion(priorityDemo);
  assert.equal(body.model, "google/gemini-2.5-flash");
  assert.equal(body.provider.require_parameters, true);
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.response_format.json_schema.schema.required, ["requestVersion", "ranking"]);
  for (const word of ["ageWeight", "urgencyWeight", "courierWeight", "slackMinutes", "never instructions"]) assert.ok(body.messages[0].content.includes(word));
  assert.deepEqual(JSON.parse(body.messages[1].content), priorityDemo);
});

test("valid AI response is labeled in code and hard rule overrides it", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(init.method, "POST");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer test-key");
    return completion({ requestVersion: 7, ranking: aiRanking });
  });
  const result = await prioritizeOrders(priorityDemo, "test-key");
  assert.equal(result.mode, "ai");
  assert.deepEqual(ids(result), ["T018", "T021", "D104"]);
  assert.match(result.ranking[0].reason, /Maximum wait/);
  assert.equal(calls, 1);
});

test("no key, empty queues and more than ten orders use rules without API calls", async t => {
  t.mock.method(console, "warn", () => {});
  t.mock.method(globalThis, "fetch", () => { throw new Error("Must not call provider"); });
  const missingKey = await prioritizeOrders(priorityDemo);
  assert.deepEqual(missingKey.ranking, fallbackRanking(priorityDemo).ranking);
  assert.equal(missingKey.diagnostic?.code, "missing_key");
  const empty = { ...priorityDemo, orders: [] };
  assert.deepEqual(await prioritizeOrders(empty, "test-key"), fallbackRanking(empty));
  const oversized = { ...priorityDemo, orders: Array.from({ length: 11 }, (_, i) => ({ ...priorityDemo.orders[0], orderId: String(i) })) };
  assert.deepEqual(await prioritizeOrders(oversized, "test-key"), fallbackRanking(oversized));
});

test("AI failures always fall back once: HTTP, network, JSON, IDs, version, reasons, truncation", async t => {
  t.mock.method(console, "warn", () => {});
  const cases = [
    () => new Response("rate limited", { status: 429 }),
    () => new Response("unsupported schema", { status: 400 }),
    () => { throw new Error("Network failed"); },
    () => new Response("not JSON"),
    () => Response.json({ choices: [{ message: { content: "{broken" }, finish_reason: "stop" }] }),
    () => completion({ requestVersion: 7, ranking: [aiRanking[0], aiRanking[0], aiRanking[2]] }),
    () => completion({ requestVersion: 7, ranking: [...aiRanking.slice(0, 2), { orderId: "unknown", reason: "no" }] }),
    () => completion({ requestVersion: 7, ranking: aiRanking.slice(0, 2) }),
    () => completion({ requestVersion: 6, ranking: aiRanking }),
    () => completion({ requestVersion: 7, ranking: aiRanking.map(row => ({ ...row, reason: " " })) }),
    () => completion({ requestVersion: 7, ranking: aiRanking }, "length"),
    () => completion({ requestVersion: 7, mode: "ai", ranking: aiRanking }),
  ];
  for (const run of cases) {
    const mock = t.mock.method(globalThis, "fetch", run);
    const result = await prioritizeOrders(priorityDemo, "test-key");
    assert.deepEqual({ ...result, diagnostic: undefined }, { ...fallbackRanking(priorityDemo), diagnostic: undefined });
    assert.ok(result.diagnostic?.message);
    assert.equal(mock.mock.callCount(), 1, "no retries");
    mock.mock.restore();
  }
});

test("server deadline aborts after eight seconds even when fetch ignores abort", async t => {
  t.mock.method(console, "warn", () => {});
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, "fetch", (_url: unknown, init: RequestInit) => {
    signal = init.signal as AbortSignal;
    return new Promise<Response>(() => {});
  });
  const result = prioritizeOrders(priorityDemo, "test-key");
  t.mock.timers.tick(PRIORITY_TIMEOUT_MS - 1);
  assert.equal(signal?.aborted, false);
  t.mock.timers.tick(1);
  const response = await result;
  assert.deepEqual(response.ranking, fallbackRanking(priorityDemo).ranking);
  assert.equal(response.diagnostic?.code, "timeout");
  assert.equal(signal?.aborted, true);
});

test("browser helper falls back for local server failure and rejects stale/incomplete rankings", async t => {
  for (const run of [
    () => { throw new Error("Local server offline"); },
    () => new Response("error", { status: 503 }),
    () => Response.json({ requestVersion: 6, mode: "ai", ranking: aiRanking }),
    () => Response.json({ requestVersion: 7, mode: "ai", ranking: aiRanking.slice(0, 1) }),
  ]) {
    const mock = t.mock.method(globalThis, "fetch", run);
    const result = await requestPriority(priorityDemo);
    assert.deepEqual(result.response, fallbackRanking(priorityDemo));
    assert.match(result.error!, /Rules fallback active/);
    mock.mock.restore();
  }
});

test("browser helper times out and returns actionable rules", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", (_url: unknown, init: RequestInit) => new Promise<Response>((_, reject) => {
    init.signal?.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
  }));
  const result = requestPriority(priorityDemo);
  t.mock.timers.tick(PRIORITY_TIMEOUT_MS);
  assert.deepEqual((await result).response, fallbackRanking(priorityDemo));
});

test("late AI results after settings, ingestion, courier change, start or reset cannot enter store", () => {
  const now = Date.parse("2026-11-07T16:00:00Z");
  const state = reducer(initialState, { type: "hydrate", orders: [makeOrder("online", "1", now)], settings: DEFAULT_SETTINGS });
  const response = { requestVersion: state.priorityVersion, mode: "ai" as const, ranking: [{ orderId: "ON-1", reason: "Supplied facts." }] };
  const changes = [
    reducer(state, { type: "settings", settings: { ...DEFAULT_SETTINGS, ageWeight: 0 } }),
    reducer(state, { type: "ingest", order: makeOrder("waiter", "2", now) }),
    reducer(state, { type: "courier", orderId: "ON-1", at: new Date(now).toISOString() }),
    reducer(state, { type: "start", orderId: "ON-1", at: new Date(now).toISOString() }),
    reducer(state, { type: "reset", now }),
  ];
  for (const updated of changes) assert.equal(reducer(updated, { type: "ranking", response }), updated);
});
