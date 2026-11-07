import assert from "node:assert/strict";
import test from "node:test";
import { appFetch, BROWSER_WORKSPACE_KEY, configureBrowserDemo } from "../src/lib/apiClient";

test("browser demo serializes overlapping requests and carries the latest workspace to the next request", async t => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } } });
  configureBrowserDemo(true);
  const calls: Array<{ path: string; workspace: string | null }> = [];
  let finishFirst: (() => void) | undefined;
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(options.body as string); calls.push(body);
    if (calls.length === 1) await new Promise<void>(resolve => { finishFirst = resolve; });
    return Response.json({ status: 200, data: { order: calls.length }, workspace: `encrypted-${calls.length}` });
  });
  try {
    const first = appFetch("/api/orders", { method: "POST", body: "{}" }); const second = appFetch("/api/orders");
    await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(calls.length, 1); assert.equal(calls[0].workspace, null);
    finishFirst!(); await Promise.all([first, second]);
    assert.equal(calls[1].workspace, "encrypted-1"); assert.equal(values.get(BROWSER_WORKSPACE_KEY), "encrypted-2");
  } finally { configureBrowserDemo(false); if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window"); }
});
