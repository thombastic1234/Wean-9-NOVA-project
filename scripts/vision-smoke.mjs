// Start Next.js with a server key in .env.local. No credentials printed.
// Default is a synthetic label-card input; supply a real JPEG/PNG as argument.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

try {
  const path = process.argv[2] || 'tests/fixtures/vision/correct.png';
  const extension = extname(path).toLowerCase();
  assert.ok(['.png', '.jpg', '.jpeg'].includes(extension), 'Use JPEG/PNG');
  const imageDataUrl = `data:image/${extension === '.png' ? 'png' : 'jpeg'};base64,${(await readFile(path)).toString('base64')}`;
  const scanId = `live-smoke-${Date.now()}`;
  const response = await fetch(`${process.env.APP_URL || 'http://127.0.0.1:3000'}/api/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ orderId: 'VISION-SMOKE', scanId, imageDataUrl, expectedItems: [
      { menuItemId: 'burger', quantity: 1 }, { menuItemId: 'fries', quantity: 1 }, { menuItemId: 'milkshake', quantity: 1 },
    ] }),
  });
  assert.equal(response.status, 200, 'Verification route must accept the image');
  const result = await response.json();
  assert.equal(result.orderId, 'VISION-SMOKE');
  assert.equal(result.scanId, scanId);
  assert.ok(['match', 'mismatch', 'review_needed'].includes(result.result));
  assert.ok(result.observed.length > 0, 'Live smoke NOT passed: no recognized items. Check server credentials/provider or use a clearer image.');
  console.log('PASS: live image request returned validated structured observations. This does not establish recognition accuracy.');
  console.log(JSON.stringify(result, null, 2));
  if (!process.argv[2]) console.log('Input was synthetic label cards, not food. Label use requires staff review.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
