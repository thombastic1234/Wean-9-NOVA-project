// Authenticated live check. Test responses and rules fallback do not count as live AI.
import assert from 'node:assert/strict';
import { smokeSession } from './smoke-session.mjs';
try {
  const call = await smokeSession(['MANAGER', 'CHEF']);
  const source = process.env.PASSCHECK_SMOKE_SOURCE || 'ONLINE';
  const data = await (await call(`/api/orders?source=${encodeURIComponent(source)}`)).json();
  const queued = data.orders.filter(order => order.status === 'PLACED').slice(0, 10);
  assert.ok(queued.length, 'Create at least one placed order before the live priority check');
  const { settings } = await (await call('/api/settings')).json();
  const now = Date.now();
  const request = { requestVersion: 1, settings, orders: queued.map(order => ({ orderId: order.id, fulfillment: order.fulfillment.toLowerCase(), ageMinutes: Math.max(0, (now - Date.parse(order.createdAt)) / 60_000), estimatedPrepMinutes: 8, minutesUntilTargetReady: (Date.parse(order.createdAt) + 20 * 60_000 - now) / 60_000, courierWaitingMinutes: 0 })) };
  const response = await call('/api/prioritize', { method: 'POST', body: JSON.stringify(request) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.requestVersion, 1);
  assert.deepEqual(result.ranking.map(row => row.orderId).sort(), queued.map(order => order.id).sort());
  assert.equal(result.mode, 'ai', 'Live smoke NOT passed: server returned rules fallback');
  console.log('PASS: authenticated live priority request returned complete structured AI ranking. This does not establish scheduling quality.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
