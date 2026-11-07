import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { verifyRequestSchema, visionResponseSchema } from "../src/lib/contracts";
import { buildVisionCompletion, compareObservation, observationSchema, verifyPhoto, VISION_TIMEOUT_MS, type VerifyRequest } from "../src/lib/visionService";
import { processVisionRequest as POST } from "../src/server/visionHandler";

const imageDataUrl = "data:image/png;base64," + readFileSync("tests/fixtures/vision/correct.png").toString("base64");
const request: VerifyRequest = { orderId: "ON-1", scanId: "scan-1", imageDataUrl,
  expectedItems: [{ menuItemId: "burger", quantity: 1 }, { menuItemId: "fries", quantity: 1 }, { menuItemId: "milkshake", quantity: 1 }] };
const matching = { observed: request.expectedItems, unknownItems: [], uncertainties: [] };
const httpRequest = (body: unknown, headers = {}) => new Request("http://localhost/api/verify", {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});
const completion = (value: unknown, finish_reason = "stop") => Response.json({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason }] });

test("specified missing fries / extra milkshake acceptance case", () => {
  const result = compareObservation(request, { observed: [{ menuItemId: "burger", quantity: 1 }, { menuItemId: "milkshake", quantity: 2 }], unknownItems: [], uncertainties: [] });
  assert.equal(result.result, "mismatch");
  assert.deepEqual(result.missing, [{ menuItemId: "fries", quantity: 1 }]);
  assert.deepEqual(result.extra, [{ menuItemId: "milkshake", quantity: 1 }]);
});
test("match requires no unknowns or uncertainty; definite discrepancies take precedence", () => {
  assert.equal(compareObservation(request, matching).result, "match");
  for (const observation of [{ ...matching, unknownItems: ["unlabeled object"] }, { ...matching, uncertainties: ["hidden item"] }]) {
    assert.equal(compareObservation(request, observation).result, "review_needed");
    assert.equal(compareObservation(request, { ...observation, observed: [] }).result, "mismatch");
  }
  assert.deepEqual(compareObservation(request, { ...matching, observed: [...matching.observed, { menuItemId: "salad", quantity: 1 }] }).extra, [{ menuItemId: "salad", quantity: 1 }]);
});
test("expected duplicates aggregate; invalid or duplicate observations are rejected", () => {
  const repeated = { ...request, expectedItems: [{ menuItemId: "burger" as const, quantity: 1 }, { menuItemId: "burger" as const, quantity: 1 }] };
  assert.equal(compareObservation(repeated, { ...matching, observed: [{ menuItemId: "burger", quantity: 2 }] }).result, "match");
  for (const observed of [
    [{ menuItemId: "burger", quantity: 1 }, { menuItemId: "burger", quantity: 1 }],
    [{ menuItemId: "pizza", quantity: 1 }], [{ menuItemId: "burger", quantity: -1 }],
    [{ menuItemId: "burger", quantity: 1.5 }], [{ menuItemId: "burger", quantity: 101 }],
  ]) assert.equal(observationSchema.safeParse({ ...matching, observed }).success, false);
});
test("prompt contains full catalog and image but no expected quantities or order IDs", () => {
  const completion = buildVisionCompletion(request.imageDataUrl);
  const text = JSON.stringify(completion);
  for (const id of ["burger", "fries", "milkshake", "salad"]) assert.ok(text.includes(id));
  assert.ok(text.includes(request.imageDataUrl));
  assert.ok(!text.includes("expectedItems"));
  assert.ok(!text.includes(request.orderId));
  assert.equal(completion.provider.require_parameters, true);
});
test("valid provider output produces fresh per-scan counts with server IDs", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => completion(++calls === 1 ? matching : { ...matching, observed: [] }));
  const first = await verifyPhoto(request, "test-only-key");
  const second = await verifyPhoto({ ...request, scanId: "scan-2" }, "test-only-key");
  assert.equal(first.result, "match");
  assert.equal(second.scanId, "scan-2");
  assert.equal(second.orderId, request.orderId);
  assert.deepEqual(second.observed, []);
  assert.equal(second.result, "mismatch");
});
test("failures and invalid output never fabricate observations or missing counts", async t => {
  const cases = [
    async () => { throw new Error("sensitive provider detail"); },
    async () => new Response("private", { status: 401 }),
    async () => Response.json({ choices: [{ message: { content: "invalid json" }, finish_reason: "stop" }] }),
    async () => completion(matching, "length"),
    async () => completion({ ...matching, observed: [...matching.observed, matching.observed[0]] }),
    async () => completion({ ...matching, orderId: "injected" }),
    async () => Response.json({ choices: [] }),
  ];
  for (const fakeFetch of cases) {
    const mock = t.mock.method(globalThis, "fetch", fakeFetch);
    const result = await verifyPhoto(request, "test-only-key");
    assert.equal(result.result, "review_needed");
    assert.deepEqual(result.observed, []);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.extra, []);
    assert.ok(!JSON.stringify(result).includes("sensitive"));
    mock.mock.restore();
  }
  assert.equal((await verifyPhoto(request)).result, "review_needed");
});
test("12-second deadline aborts request and bounds hung body parsing", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    signal = init?.signal as AbortSignal;
    return { ok: true, json: () => new Promise(() => {}) } as Response;
  });
  const pending = verifyPhoto(request, "test-only-key");
  await Promise.resolve();
  t.mock.timers.tick(VISION_TIMEOUT_MS);
  const result = await pending;
  assert.equal(signal?.aborted, true);
  assert.equal(result.result, "review_needed");
  assert.match(result.uncertainties[0], /timed out/);
});
test("route accepts actual fixture and returns validated normalized response", async t => {
  t.mock.method(globalThis, "fetch", async () => completion(matching));
  const response = await POST(httpRequest(request));
  assert.equal(response.status, 200);
  const result = visionResponseSchema.parse(await response.json());
  assert.equal(result.scanId, request.scanId);
});
test("input rejects zero/fractional/unknown/excess counts, WebP, corrupt base64 and MIME mismatch", async () => {
  for (const quantity of [0, -1, 1.5, 101]) assert.equal(verifyRequestSchema.safeParse({ ...request, expectedItems: [{ menuItemId: "burger", quantity }] }).success, false);
  assert.equal(verifyRequestSchema.safeParse({ ...request, expectedItems: [{ menuItemId: "burger", quantity: 60 }, { menuItemId: "burger", quantity: 60 }] }).success, false);
  for (const body of [
    { ...request, expectedItems: [{ menuItemId: "pizza", quantity: 1 }] },
    { ...request, imageDataUrl: "data:image/webp;base64,aGVsbG8=" },
    { ...request, imageDataUrl: "data:image/png;base64,aGVsbG8=" },
    { ...request, imageDataUrl: imageDataUrl.replace("image/png", "image/jpeg") },
    { ...request, imageDataUrl: "data:image/png;base64," },
  ]) assert.equal((await POST(httpRequest(body))).status, 400);
});
test("4MB limit applies to declared and actual body bytes", async () => {
  assert.equal((await POST(httpRequest(request, { "Content-Length": "5000000" }))).status, 413);
  assert.equal((await POST(httpRequest({ data: "x".repeat(4 * 1024 * 1024) }))).status, 413);
});
