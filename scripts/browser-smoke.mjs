// Optional local browser check using Node's built-in WebSocket and installed Edge.
// Start the app first. Run: node scripts/browser-smoke.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const browserPath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = await mkdtemp(join(tmpdir(), 'passcheck-browser-'));
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
let sequence = 0;
const pending = new Map();
const errors = [];
async function until(fn, description) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const value = await fn(); if (value) return value; } catch {}
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}
function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}
async function click(text) {
  assert.equal(await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled); if (!button) return false; button.click(); return true; })()`), true, `Enabled button: ${text}`);
}
const stored = `JSON.parse(localStorage.getItem('passcheck.demo.v1'))`;
const order = id => `${stored}.orders.find(o => o.id === ${JSON.stringify(id)})`;
async function screenshot(name) {
  const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(join('test-results', name), Buffer.from(shot.data, 'base64'));
}

try {
  const port = await until(async () => (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0], 'browser launch');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const item = pending.get(message.id);
      if (item) { pending.delete(message.id); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); }
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(arg => arg.value || arg.description).join(' '));
  });
  await command('Runtime.enable');
  await command('Page.enable');
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `window.__priorityCalls = 0; const originalFetch = window.fetch.bind(window); window.fetch = (...args) => { if (args[0] === '/api/prioritize') window.__priorityCalls++; return originalFetch(...args); };` });
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: process.env.APP_URL || 'http://127.0.0.1:3000' });
  await until(() => evaluate(`document.querySelectorAll('.queue-column .ticket').length === 6`), 'six initial queue tickets');
  await until(() => evaluate(`document.querySelector('.priority-reason')?.textContent.includes('Rules score')`), 'priority fallback');
  assert.equal(await evaluate('window.__priorityCalls'), 0, 'initial rendering makes no automatic API request');
  await click('Reprioritize');
  await until(() => evaluate(`!document.querySelector('.priority-actions button').disabled`), 'explicit priority request finishes');
  assert.equal(await evaluate('window.__priorityCalls'), 1);
  assert.equal(await evaluate(`document.querySelector('.mode-pill').textContent`), 'Rules fallback active');

  // Hold a simulated test response to verify no overlap, actionable tickets, and stale-result rejection.
  await evaluate(`window.__realFetch = window.fetch; window.fetch = (url, options) => { if (url !== '/api/prioritize') return window.__realFetch(url, options); window.__priorityCalls++; window.__priorityRequest = JSON.parse(options.body); return new Promise(resolve => window.__resolvePriority = resolve); };`);
  await evaluate(`document.querySelector('.priority-actions button').click(); document.querySelector('.priority-actions button').click();`);
  await until(() => evaluate('typeof window.__resolvePriority === "function"'), 'held test request');
  assert.equal(await evaluate('window.__priorityCalls'), 2, 'overlapping clicks start only one request');
  assert.equal(await evaluate(`document.querySelector('.queue-column .ticket button.full').disabled`), false, 'queue stays actionable during loading');
  await click('Waiter order');
  await until(() => evaluate(`document.querySelectorAll('.queue-column .ticket').length === 7`), 'input changes during loading');
  await evaluate(`window.__resolvePriority(new Response(JSON.stringify({ requestVersion: window.__priorityRequest.requestVersion, mode: 'ai', ranking: window.__priorityRequest.orders.map(o => ({ orderId: o.orderId, reason: 'Simulated stale test response' })) }), { headers: { 'Content-Type': 'application/json' } })); window.fetch = window.__realFetch;`);
  await until(() => evaluate(`!document.querySelector('.priority-actions button').disabled`), 'stale request ends');
  assert.equal(await evaluate(`document.querySelector('.mode-pill').textContent`), 'Rules fallback active', 'stale AI result cannot replace current rules');
  assert.equal(await evaluate(`document.body.textContent.includes('Simulated stale test response')`), false);
  await click('Reset demo'); await click('Reset demo now');
  await until(() => evaluate(`document.querySelectorAll('.queue-column .ticket').length === 6`), 'reset after priority tests');
  assert.equal(await evaluate(`(() => { const ticket = document.querySelector('.queue-column .ticket'); const button = ticket.querySelector('button.full'); const t = ticket.getBoundingClientRect(); const b = button.getBoundingClientRect(); return t.height > 200 && b.bottom <= t.bottom; })()`), true, 'queue cards retain their contents inside the scroll area');
  await mkdir('test-results', { recursive: true });
  await screenshot('desktop-queue.png');
  await click('Waiter order'); await click('Online order');
  await until(() => evaluate(`${stored}.orders.length === 8`), 'both source buttons');
  await evaluate(`document.querySelector('.queue-column .ticket button.full').click()`);
  await until(() => evaluate(`${order('ON-1041')}.status === 'cooking'`), 'start cooking');
  await click('Finish cooking');
  await until(() => evaluate(`document.querySelector('.packing-ticket') !== null`), 'packing panel');
  assert.equal(await evaluate(`document.querySelector('.packing-ticket button.lime').disabled`), true);
  await evaluate(`document.querySelectorAll('.check-row input').forEach(input => input.click())`);
  await click('Complete manual check');
  await until(() => evaluate(`${order('ON-1041')}.verification?.result === 'manual_checked'`), 'manual check');
  assert.equal(await evaluate(`document.querySelector('.packing-ticket button.lime').disabled`), true);
  await evaluate(`document.querySelector('.seal-check input').click()`);
  assert.equal(await evaluate(`document.querySelector('.packing-ticket button.lime').disabled`), true);
  await evaluate(`(() => { const select = document.querySelector('.location-field select'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'Shelf A1'); select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await screenshot('desktop-packing.png');
  await click('Mark ready for pickup');
  await until(() => evaluate(`document.querySelector('.pickup-card')?.textContent.includes('PON1041')`), 'pickup board');
  assert.equal(await evaluate(`document.querySelector('.pickup-card').textContent.includes('Shelf A1')`), true);
  await command('Page.reload', { ignoreCache: true });
  await until(() => evaluate(`document.querySelector('.pickup-card')?.textContent.includes('PON1041')`), 'restore ready ticket');
  assert.equal(await evaluate(`${stored}.orders.length`), 8, 'refresh preserves orders before initial persistence write');
  assert.equal(await evaluate(`${order('ON-1041')}.handoffLocation`), 'Shelf A1');
  await screenshot('desktop-ready.png');
  await click('Mark collected');
  await until(() => evaluate(`document.querySelectorAll('.pickup-card').length === 0`), 'collected ticket leaves board');
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'mobile has no horizontal overflow');
  await screenshot('mobile-queue.png');
  await click('Reset demo'); await click('Reset demo now');
  await until(() => evaluate(`${stored}.orders.length === 6 && ${stored}.orders.every(o => o.status === 'queued' && !o.verification && !o.handoffLocation)`), 'reset clears state');
  // Two packing orders must retain separate authoritative checks while local state resets.
  await evaluate(`document.querySelector('.queue-column .ticket button.full').click()`);
  await click('Finish cooking');
  await evaluate(`document.querySelectorAll('.check-row input').forEach(input => input.click())`);
  await click('Complete manual check');
  await until(() => evaluate(`${order('ON-1041')}.verification?.result === 'manual_checked'`), 'first order rechecked');
  await evaluate(`(() => { const ticket = [...document.querySelectorAll('.queue-column .ticket')].find(ticket => ticket.querySelector('h3').textContent === 'IN-1042'); ticket.querySelector('button.full').click(); })()`);
  await click('Finish cooking');
  await until(() => evaluate(`document.querySelector('.packing-ticket h3')?.textContent === 'IN-1042'`), 'second order selected');
  assert.equal(await evaluate(`document.querySelectorAll('.check-row input:checked').length`), 0, 'switching orders cannot copy a check');
  await click('ON-1041');
  assert.equal(await evaluate(`document.querySelectorAll('.check-row input:checked').length > 0`), true, 'first check remains in shared state');
  await click('IN-1042');
  assert.equal(await evaluate(`document.querySelectorAll('.check-row input:checked').length`), 0);
  await evaluate(`document.querySelectorAll('.check-row input').forEach(input => input.click())`);
  await click('Complete manual check');
  await evaluate(`document.querySelector('.seal-check input').click()`);
  await evaluate(`(() => { const select = document.querySelector('.location-field select'); select.value = 'Pass 2'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await click('Mark ready for pickup');
  await until(() => evaluate(`document.querySelector('.pickup-card')?.textContent.includes('Pass 2')`), 'dine-in ready location');
  assert.equal(await evaluate(`${order('IN-1042')}.tableNumber`), '03', 'table destination is separate from pass');
  await click('Reset demo'); await click('Reset demo now');
  await until(() => evaluate(`${stored}.orders.every(o => o.status === 'queued')`), 'clean final demo');
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('PASS: explicit prioritization, no overlapping requests, stale response rejection, actionable queue, both sources, full manual journey, readiness guards, refresh persistence, collection, mobile layout, reset, packing order switching, dine-in location, no browser errors.');
  console.log('Screenshots: test-results/desktop-queue.png, desktop-packing.png, desktop-ready.png, mobile-queue.png');
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  browser.kill();
}
