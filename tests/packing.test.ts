import assert from "node:assert/strict";
import test from "node:test";
import { checkPackingPhoto, preparePackingPhoto, type PhotoCheckRequest } from "../src/lib/packingClient";

const request: PhotoCheckRequest = {
  orderId: "ON-1", scanId: "scan-1", imageDataUrl: "data:image/jpeg;base64,aGVsbG8=",
  expectedItems: [
    { menuItemId: "burger", name: "Burger", quantity: 1 },
    { menuItemId: "fries", name: "Fries", quantity: 1 },
    { menuItemId: "milkshake", name: "Milkshake", quantity: 1 },
  ],
};
const match = { orderId: request.orderId, scanId: request.scanId, result: "match", observed: request.expectedItems.map(({ menuItemId, quantity }) => ({ menuItemId, quantity })), missing: [], extra: [], unknownItems: [], uncertainties: [] };
const signal = () => new AbortController().signal;

test("photo client sends agreed IDs/counts and accepts a simulated match", async t => {
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "/api/verify");
    assert.equal(options.method, "POST");
    assert.equal(options.signal?.aborted, false);
    const body = JSON.parse(String(options.body));
    assert.deepEqual(body, { ...request, expectedItems: match.observed });
    return Response.json(match);
  });
  assert.deepEqual(await checkPackingPhoto(request, signal()), match);
});

test("simulated missing fries and extra milkshake are preserved, then replaced by a new scan", async t => {
  const mismatch = { ...match, result: "mismatch", observed: [{ menuItemId: "burger", quantity: 1 }, { menuItemId: "milkshake", quantity: 2 }], missing: [{ menuItemId: "fries", quantity: 1 }], extra: [{ menuItemId: "milkshake", quantity: 1 }] };
  t.mock.method(globalThis, "fetch", async () => Response.json(mismatch));
  const first = await checkPackingPhoto(request, signal());
  assert.deepEqual(first.missing, [{ menuItemId: "fries", quantity: 1 }]);
  assert.deepEqual(first.extra, [{ menuItemId: "milkshake", quantity: 1 }]);
  t.mock.method(globalThis, "fetch", async () => Response.json({ ...match, scanId: "scan-2" }));
  const second = await checkPackingPhoto({ ...request, scanId: "scan-2" }, signal());
  assert.equal(second.result, "match");
  assert.deepEqual(second.missing, []);
  assert.deepEqual(second.observed, match.observed);
});

test("invalid, mismatched, stale, or unsupported success results are rejected", async t => {
  for (const body of [
    {}, { ...match, result: "manual_checked" }, { ...match, orderId: "another-order" },
    { ...match, scanId: "old-scan" }, { ...match, observed: [] },
    { ...match, observed: [...match.observed, { menuItemId: "milkshake", quantity: 1 }] },
    { ...match, unknownItems: ["opaque container"] }, { ...match, uncertainties: ["occluded"] },
  ]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(body));
    await assert.rejects(checkPackingPhoto(request, signal()));
  }
  t.mock.method(globalThis, "fetch", async () => new Response("not JSON"));
  await assert.rejects(checkPackingPhoto(request, signal()));
});

test("HTTP, network, and abort failures cannot yield a successful check", async t => {
  for (const status of [400, 413, 500, 503]) {
    t.mock.method(globalThis, "fetch", async () => new Response(null, { status }));
    await assert.rejects(checkPackingPhoto(request, signal()), /photo|Photo|Vision/);
  }
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Network unavailable"); });
  await assert.rejects(checkPackingPhoto(request, signal()));
  t.mock.method(globalThis, "fetch", async () => { throw new DOMException("Aborted", "AbortError"); });
  await assert.rejects(checkPackingPhoto(request, signal()));
});

test("unsupported, empty, and oversized files fail before image decoding", async () => {
  await assert.rejects(preparePackingPhoto({ type: "image/gif", size: 30 } as File), /JPEG or PNG/);
  await assert.rejects(preparePackingPhoto({ type: "image/jpeg", size: 0 } as File), /20 MB/);
  await assert.rejects(preparePackingPhoto({ type: "image/png", size: 21 * 1024 * 1024 } as File), /20 MB/);
});
