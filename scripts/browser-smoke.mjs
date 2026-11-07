// Optional local browser check using Node's built-in WebSocket and Chrome/Edge.
// Start the app first. Run: node scripts/browser-smoke.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const browserPath = process.env.EDGE_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
const profile = await mkdtemp(join(tmpdir(), 'passcheck-browser-'));
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
let sequence = 0;
const pending = new Map();
const errors = [];
async function until(fn, description, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt++) {
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
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
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

  // Packing acceptance uses simulated vision results, never a live recognition claim.
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  await evaluate(`(() => { const state = ${stored}; state.orders[0].items = [{menuItemId:'burger',name:'Burger',quantity:1},{menuItemId:'fries',name:'Fries',quantity:1},{menuItemId:'cola',name:'Cola',quantity:1}]; localStorage.setItem('passcheck.demo.v1', JSON.stringify(state)); })()`);
  await command('Page.reload', { ignoreCache: true });
  await until(() => evaluate(`document.querySelectorAll('.queue-column .ticket').length === 6`), 'packing fixture reload');
  await evaluate(`document.querySelector('.queue-column .ticket button.full').click()`);
  await click('Finish cooking');
  await evaluate(`window.__upload = async (type = 'image/png') => { const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1800; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f6f2df'; ctx.fillRect(0,0,2400,1800); ctx.fillStyle = '#27382a'; ctx.font = '100px sans-serif'; ctx.fillText('SIMULATED TEST PHOTO',100,300); const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/png')); const data = new DataTransfer(); data.items.add(new File([blob], 'packing-test.png', {type})); const input = document.querySelector('.photo-upload input'); input.files = data.files; input.dispatchEvent(new Event('change', {bubbles:true})); };`);
  await evaluate(`window.__upload()`);
  await until(() => evaluate(`document.querySelector('.packing-photo img')?.naturalWidth === 1024`), 'resized image preview');
  await click('Check photo');
  await until(() => evaluate(`document.querySelector('.verification-result')?.textContent.includes('Live vision is unavailable')`), 'real endpoint honest missing-key review');
  assert.equal(await evaluate(`document.querySelector('.seal-check input').disabled`), true);
  assert.equal(await evaluate(`document.querySelector('.packing-manual').disabled`), false, 'manual fallback remains available');

  await evaluate(`window.__visionCalls = 0; window.__visionFetch = window.fetch; window.fetch = (url, options) => { if (url !== '/api/verify') return window.__visionFetch(url, options); window.__visionCalls++; const request = JSON.parse(options.body); window.__lastVisionRequest = request; return new Promise((resolve,reject) => { window.__resolveVision = response => resolve(new Response(JSON.stringify({orderId:request.orderId,scanId:request.scanId,...response}),{headers:{'Content-Type':'application/json'}})); options.signal.addEventListener('abort', () => reject(new DOMException('Aborted','AbortError'))); }); }; window.__match = { result:'match', observed:[{menuItemId:'burger',quantity:1},{menuItemId:'fries',quantity:1},{menuItemId:'cola',quantity:1}], missing:[],extra:[],unknownItems:[],uncertainties:[] };`);
  await evaluate(`document.querySelector('.packing-photo-actions button').click(); document.querySelector('.packing-photo-actions button').click();`);
  await until(() => evaluate(`window.__visionCalls === 1`), 'single pending photo request');
  assert.equal(await evaluate(`document.querySelector('.packing-pending').textContent`), 'Checking photo…');
  assert.equal(await evaluate(`document.querySelector('.seal-check input').disabled`), true);
  await evaluate(`window.__resolveVision({...window.__match,result:'mismatch',observed:[{menuItemId:'burger',quantity:1},{menuItemId:'cola',quantity:2}],missing:[{menuItemId:'fries',quantity:1}],extra:[{menuItemId:'cola',quantity:1}]})`);
  await until(() => evaluate(`document.querySelector('.verification-result.mismatch')?.textContent.includes('Missing: Fries ×1')`), 'missing fries quantity');
  assert.equal(await evaluate(`document.querySelector('.verification-result.mismatch').textContent.includes('Extra: Cola ×1')`), true);
  await screenshot('packing-mismatch.png');
  await click('Recheck photo');
  await evaluate(`window.__resolveVision(window.__match)`);
  await until(() => evaluate(`document.querySelector('.verification-result.match')?.textContent.includes('Visible counts match')`), 'rescan replaces mismatch');
  assert.equal(await evaluate(`${order('ON-1041')}.verification.observed.find(i => i.menuItemId === 'cola').quantity`), 1, 'counts replace rather than accumulate');
  await evaluate(`document.querySelector('.seal-check input').click()`);
  await screenshot('packing-match.png');
  await evaluate(`window.__upload()`);
  await until(() => evaluate(`${order('ON-1041')}.verification === null && ${order('ON-1041')}.packingConfirmedAt === null && document.querySelector('.packing-photo img')?.naturalWidth === 1024`), 'changed photo clears check and confirmation');
  await click('Check photo');
  await evaluate(`window.__staleVision = window.__resolveVision; window.__upload()`);
  await until(() => evaluate(`document.querySelector('.packing-photo img')?.naturalWidth === 1024`), 'replacement prepared during pending request');
  await evaluate(`window.__staleVision(window.__match)`);
  assert.equal(await evaluate(`${order('ON-1041')}.verification`), null, 'old photo response ignored');
  await click('Check photo');
  await evaluate(`window.__resolveVision({...window.__match,scanId:'wrong-scan'})`);
  await until(() => evaluate(`document.querySelector('.verification-result.review_needed')?.textContent.includes('invalid or outdated')`), 'wrong scan rejected');
  await evaluate(`document.querySelectorAll('.check-row input').forEach(input => { if (!input.closest('label').textContent.includes('No extra')) input.click(); })`);
  assert.equal(await evaluate(`document.querySelector('.packing-manual button').disabled`), true, 'separate no-extras checkbox required');
  await evaluate(`document.querySelector('.check-row:last-child input').click()`);
  await click('Complete manual check');
  await until(() => evaluate(`${order('ON-1041')}.verification?.result === 'manual_checked'`), 'manual fallback after failed photo check');
  await evaluate(`document.querySelector('.seal-check input').click(); window.__upload('image/gif')`);
  await until(() => evaluate(`document.querySelector('.verification-result.review_needed')?.textContent.includes('Choose a JPEG or PNG')`), 'unsupported file error');
  assert.equal(await evaluate(`${order('ON-1041')}.packingConfirmedAt`), null);
  await evaluate(`window.__upload()`);
  await until(() => evaluate(`document.querySelector('.packing-photo img')?.naturalWidth === 1024`), 'new photo after unsupported file');
  await click('Check photo');
  await until(() => evaluate(`document.querySelector('.verification-result.review_needed')?.textContent.includes('timed out')`), 'photo request deadline', 200);
  await click('Recheck photo');
  await evaluate(`window.__otherOrderResponse = window.__resolveVision; [...document.querySelectorAll('.queue-column .ticket')].find(ticket => ticket.querySelector('h3').textContent === 'IN-1042').querySelector('button.full').click()`);
  await click('Finish cooking');
  await click('IN-1042');
  await until(() => evaluate(`document.querySelector('.packing-ticket h3').textContent === 'IN-1042'`), 'switch away from pending scan');
  await evaluate(`window.__otherOrderResponse(window.__match)`);
  assert.equal(await evaluate(`${order('ON-1041')}.verification`), null, 'unmounted pending scan cannot update old order');
  assert.equal(await evaluate(`document.querySelector('.packing-photo img')`), null, 'order switch clears photo');
  assert.equal(await evaluate(`${order('IN-1042')}.verification`), null, 'other order response ignored');
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate(`window.__upload()`);
  await until(() => evaluate(`document.querySelector('.packing-photo img')?.naturalWidth === 1024`), 'mobile photo');
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, 'packing upload has no mobile overflow');
  await screenshot('packing-mobile.png');
  await evaluate(`window.fetch = window.__visionFetch`);
  await click('Reset demo'); await click('Reset demo now');

  assert.deepEqual(errors, [], 'no browser errors');
  console.log('PASS: upload/resizing, real missing-key review fallback, simulated mismatch/match replacement, duplicate clicks, stale photo/order results, changed photo invalidation, manual no-extras gate, unsupported images, timeout, mobile packing; explicit prioritization, no overlapping requests, stale response rejection, actionable queue, both sources, full manual journey, readiness guards, refresh persistence, collection, mobile layout, reset, packing order switching, dine-in location, no browser errors.');
  console.log('Screenshots: test-results/desktop-queue.png, desktop-packing.png, desktop-ready.png, mobile-queue.png');
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  browser.kill();
}
