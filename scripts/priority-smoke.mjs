// Start Next.js with OPENROUTER_API_KEY in .env.local first. Never prints credentials.
import assert from 'node:assert/strict';

const request = {
  requestVersion: 1,
  settings: { ageWeight: 3, urgencyWeight: 5, courierWeight: 4, maxWaitMinutes: 20 },
  orders: [
    { orderId: 'D104', fulfillment: 'delivery', ageMinutes: 12, minutesUntilTargetReady: 4, estimatedPrepMinutes: 6, courierWaitingMinutes: 3 },
    { orderId: 'T021', fulfillment: 'dine_in', ageMinutes: 8, minutesUntilTargetReady: 12, estimatedPrepMinutes: 5, courierWaitingMinutes: 0 },
    { orderId: 'T018', fulfillment: 'dine_in', ageMinutes: 22, minutesUntilTargetReady: 15, estimatedPrepMinutes: 5, courierWaitingMinutes: 0 },
  ],
};
try {
  const response = await fetch(`${process.env.APP_URL || 'http://127.0.0.1:3000'}/api/prioritize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200, 'Local priority endpoint must succeed');
  const result = await response.json();
  assert.equal(result.requestVersion, request.requestVersion);
  assert.deepEqual(result.ranking.map(row => row.orderId).sort(), ['D104', 'T018', 'T021']);
  assert.equal(result.ranking[0].orderId, 'T018', 'Code must enforce the maximum-wait rule');
  assert.ok(result.ranking.every(row => typeof row.reason === 'string' && row.reason.trim().length > 0));
  assert.equal(result.mode, 'ai', 'Live text/structured-output smoke test NOT passed: server returned rules fallback. Check the server key, connectivity, or provider support.');
  console.log('PASS: live OpenRouter text + structured JSON, complete unique ranking, version, maximum-wait override.');
  for (const row of result.ranking) console.log(`${row.orderId}: ${row.reason}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
