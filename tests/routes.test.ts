import assert from "node:assert/strict";
import test from "node:test";
import { POST as prioritize } from "../src/app/api/prioritize/route";
import { POST as verify } from "../src/app/api/verify/route";
import { DEFAULT_SETTINGS } from "../src/lib/contracts";

function request(path: string, body: unknown) { return new Request(`http://localhost/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }

test("priority endpoint echoes version and uses deterministic rules without a key", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  const response = await prioritize(request("prioritize", { requestVersion: 42, settings: DEFAULT_SETTINGS, orders: [{ orderId: "ON-1", fulfillment: "delivery", ageMinutes: 3, estimatedPrepMinutes: 4, minutesUntilTargetReady: -1, courierWaitingMinutes: 0 }] }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "fallback");
  assert.equal(body.requestVersion, 42);
  assert.equal(body.ranking[0].orderId, "ON-1");
  assert.match(body.ranking[0].reason, /Rules score/);
});
test("unavailable vision returns review needed and never produces a match", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  const response = await verify(request("verify", { orderId: "ON-1", scanId: "scan-1", imageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", expectedItems: [{ menuItemId: "burger", quantity: 1 }] }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result, "review_needed");
  assert.deepEqual(body.observed, []);
  assert.equal(body.scanId, "scan-1");
});
test("both route boundaries reject invalid and malformed input", async () => {
  for (const handler of [prioritize, verify]) {
    assert.equal((await handler(request("test", {}))).status, 400);
    assert.equal((await handler(new Request("http://localhost/api/test", { method: "POST", body: "{" }))).status, 400);
  }
});
