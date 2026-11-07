// Uses an actual authorized PACKAGING order. Results are saved to that order.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { smokeSession } from './smoke-session.mjs';
try {
  const call = await smokeSession(['MANAGER', 'WAITER']);
  const { orders } = await (await call('/api/orders')).json();
  const order = orders.find(value => value.status === 'PACKAGING' && (!process.env.PASSCHECK_SMOKE_ORDER || value.id === process.env.PASSCHECK_SMOKE_ORDER));
  assert.ok(order, 'Start packaging an order before the live vision check');
  const path = process.argv[2] || 'tests/fixtures/vision/correct.png';
  const extension = extname(path).toLowerCase(); assert.ok(['.png', '.jpg', '.jpeg'].includes(extension), 'Use JPEG/PNG');
  const imageDataUrl = `data:image/${extension === '.png' ? 'png' : 'jpeg'};base64,${(await readFile(path)).toString('base64')}`;
  const scanId = randomUUID();
  assert.equal((await call(`/api/orders/${order.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'scan_started', revision: order.revision, requestId: randomUUID(), scanId }) })).status, 200);
  const response = await call('/api/verify', { method: 'POST', body: JSON.stringify({ orderId: order.id, scanId, imageDataUrl, expectedItems: order.items.map(({ menuItemId, quantity }) => ({ menuItemId, quantity })) }) });
  assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.orderId, order.id); assert.equal(result.scanId, scanId);
  assert.ok(result.observed.length > 0, 'Live smoke NOT passed: no recognized observations. Check server credentials/provider or use a clearer photo.');
  console.log('PASS: authenticated image request returned validated observations saved to the current order. This does not establish recognition accuracy.');
  console.log(JSON.stringify({ result: result.result, observed: result.observed, missing: result.missing, extra: result.extra, uncertainties: result.uncertainties }, null, 2));
  if (!process.argv[2]) console.log('Input was synthetic label cards, not food. Label use requires staff review.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
