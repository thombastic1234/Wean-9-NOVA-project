import assert from "node:assert/strict";
import test from "node:test";
import { normalizeApiKey, OpenRouterError, openRouterCompletion, checkOpenRouterKey } from "../src/server/openRouter";
import { prioritizeOrders } from "../src/lib/priorityService";
import { verifyPhoto } from "../src/lib/visionService";
import { DEFAULT_SETTINGS, type PriorityRequest } from "../src/lib/contracts";
import { GET as connection } from "../src/app/api/ai/status/route";
import { createFixedSession, FIXED_ACCOUNTS } from "../src/server/fixedAccounts";

const priority: PriorityRequest = { requestVersion: 1, settings: DEFAULT_SETTINGS, orders: [{ orderId: "DIAG", fulfillment: "takeaway", ageMinutes: 1, estimatedPrepMinutes: 8, minutesUntilTargetReady: 10, courierWaitingMinutes: 0 }] };
const vision = { orderId: "DIAG", scanId: "scan", imageDataUrl: "data:image/png;base64,aGVsbG8=", expectedItems: [{ menuItemId: "burger" as const, quantity: 1 }] };
const signal = () => new AbortController().signal;
const completion = (finish = "stop", content = "{}") => Response.json({ choices: [{ message: { content }, finish_reason: finish }] });

test("server key normalization accepts surrounding whitespace, quotes, and a pasted Bearer prefix", async t => {
  assert.equal(normalizeApiKey('  "Bearer test-only-key"  '), "test-only-key");
  assert.equal(normalizeApiKey(" 'test-only-key' "), "test-only-key");
  assert.throws(() => normalizeApiKey("key\ninvalid"), (error: unknown) => error instanceof OpenRouterError && error.diagnostic.code === "invalid_configuration");
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => { assert.equal(new Headers(init.headers).get("Authorization"), "Bearer test-only-key"); return completion(); });
  assert.equal(await openRouterCompletion({}, ' "Bearer test-only-key" ', signal()), "{}");
});
test("provider HTTP failures reach both fallback paths as safe actionable diagnostics", async t => {
  const logs: unknown[][] = []; t.mock.method(console, "warn", (...args: unknown[]) => { logs.push(args); });
  for (const [status, code] of [[401, "invalid_key"], [402, "insufficient_credits"], [403, "permission_denied"], [429, "rate_limited"], [400, "invalid_request"], [404, "model_unavailable"], [502, "provider_unavailable"]] as const) {
    const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: status, message: "private provider data test-only-secret sk-or-v1-not-real" } }, { status }));
    const ranking = await prioritizeOrders(priority, "test-only-secret");
    assert.equal(ranking.mode, "fallback"); assert.equal(ranking.diagnostic?.code, code); assert.equal(ranking.diagnostic?.upstreamStatus, status);
    const observed = await verifyPhoto(vision, "test-only-secret");
    assert.equal(observed.result, "review_needed"); assert.deepEqual(observed.observed, []);
    assert.equal(observed.uncertainties[0].includes("private provider data"), false);
    assert.equal(JSON.stringify({ ranking, observed, logs }).includes("test-only-secret"), false);
    assert.equal(JSON.stringify(logs).includes("sk-or-v1-not-real"), false);
    mock.mock.restore();
  }
  assert.ok(logs.length > 0);
});
test("HTTP 200 provider errors and truncated content are not mistaken for success", async t => {
  for (const [response, code] of [[Response.json({ error: { code: 402, message: "Not enough credits" } }), "insufficient_credits"], [completion("length", "{partial"), "truncated_response"], [completion("stop", ""), "invalid_response"], [completion("content_filter", ""), "permission_denied"]] as const) {
    const mock = t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(openRouterCompletion({}, "test-only-key", signal()), (error: unknown) => error instanceof OpenRouterError && error.diagnostic.code === code);
    mock.mock.restore();
  }
});
test("the connection check identifies missing/rejected keys and exhausted limits without returning account metadata", async t => {
  t.mock.method(console, "warn", () => {});
  assert.equal((await checkOpenRouterKey()).ok, false);
  for (const [response, expected] of [[Response.json({ error: { code: 401 } }, { status: 401 }), "invalid_key"], [Response.json({ data: { label: "private label", limit_remaining: 0 } }), "insufficient_credits"]] as const) {
    const mock = t.mock.method(globalThis, "fetch", async () => response);
    const result = await checkOpenRouterKey("test-only-key"); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.diagnostic.code, expected);
    assert.ok(!JSON.stringify(result).includes("private label")); mock.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async (url: string) => { assert.equal(url, "https://openrouter.ai/api/v1/key"); return Response.json({ data: { label: "private label", limit_remaining: null } }); });
  const valid = await checkOpenRouterKey("test-only-key"); assert.equal(valid.ok, true); assert.ok(!JSON.stringify(valid).includes("private label"));
});
test("connection checks bound hung response bodies and the diagnostic endpoint is manager-only", async t => {
  t.mock.method(console, "warn", () => {}); t.mock.timers.enable({ apis: ["setTimeout"] });
  const mock = t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: () => new Promise(() => {}) } as Response));
  const pending = checkOpenRouterKey("test-only-key"); await Promise.resolve(); t.mock.timers.tick(8_000); const result = await pending;
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.diagnostic.code, "timeout"); mock.mock.restore();
  assert.equal((await connection(new Request("https://example.test/api/ai/status"))).status, 401);
  const customer = FIXED_ACCOUNTS.find(account => account.user.role === "CUSTOMER")!.user;
  assert.equal((await connection(new Request("https://example.test/api/ai/status", { headers: { Cookie: `passcheck_session=${createFixedSession(customer)}` } }))).status, 403);
});
