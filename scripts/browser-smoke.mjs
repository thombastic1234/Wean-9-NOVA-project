// Builds must already exist. Uses a temporary SQLite database and installed Chrome/Edge.
// Run npm run test:browser. No real accounts, credentials, or API keys are used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { Repository } from '../src/server/database.ts';

const temporary = await mkdtemp(join(tmpdir(), 'passcheck-roles-'));
const databasePath = join(temporary, 'smoke.sqlite');
const repo = new Repository(databasePath);
const password = randomBytes(24).toString('hex');
const accounts = {};
for (const role of ['MANAGER', 'CUSTOMER', 'WAITER', 'CHEF', 'DRIVER']) accounts[role] = repo.createUser({ email: `${role.toLowerCase()}@smoke.invalid`, name: `${role[0]}${role.slice(1).toLowerCase()} Test`, role, password });
const other = repo.createUser({ email: 'other@smoke.invalid', name: 'Other customer', role: 'CUSTOMER', password });
const driver2 = repo.createUser({ email: 'driver2@smoke.invalid', name: 'Other driver', role: 'DRIVER', password });
const create = (user, fulfillment, source = 'ONLINE') => repo.create(user, { source, fulfillment, tableNumber: '03', deliveryAddress: '123 Smoke Street', contact: 'Test contact', notes: 'No onions', items: [{ menuItemId: 'burger', quantity: 1 }, { menuItemId: 'milkshake', quantity: 1 }] }, randomUUID());
const delivery = create(accounts.CUSTOMER, 'DELIVERY'); const hidden = create(other, 'TAKEAWAY');
create(accounts.WAITER, 'DINE_IN', 'IN_PERSON');
const portServer = createServer(); await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));
const base = `http://127.0.0.1:${port}`;
let server; let serverOutput = '';
function startServer() {
  server = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], { windowsHide: true, env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', OPENROUTER_API_KEY: '', PASSCHECK_DATABASE_PATH: databasePath, PASSCHECK_DEMO_MODE: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', chunk => { serverOutput += chunk.toString(); }); server.stderr.on('data', chunk => { serverOutput += chunk.toString(); });
}
async function stopServer() { if (!server || server.exitCode !== null) return; const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exited; }
const browserPath = process.env.EDGE_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
let browser; let socket; let sequence = 0; const pending = new Map(); const errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, description, attempts = 150) { for (let i = 0; i < attempts; i++) { try { const value = await fn(); if (value) return value; } catch {} await delay(100); } throw new Error(`Timed out: ${description}`); }
function command(method, params = {}) { const id = ++sequence; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; }
async function click(text, scope = 'document') {
  const point = await until(() => evaluate(`(() => { const root = ${scope}; if(!root)return null; const button = [...root.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled); if (!button) return null; button.scrollIntoView({block:'center',behavior:'instant'}); const rect = button.getBoundingClientRect(); const point={x:rect.x+rect.width/2,y:rect.y+rect.height/2}; return document.elementFromPoint(point.x,point.y)?.closest('button')===button?point:null; })()`), `clickable ${text}`);
  assert.ok(point, `Enabled button: ${text}`); await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }); await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
}
async function fill(selector, value) { await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Missing form element'); const proto = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(element,${JSON.stringify(value)}); element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input',{bubbles:true})); })()`); }
async function signIn(user, identifier = user.email, secret = password) {
  if (await evaluate(`Boolean(document.querySelector('.roles-header'))`)) { await click('Sign out'); await until(() => evaluate(`Boolean(document.querySelector('.auth-card'))`), 'sign-out'); }
  await fill('[name=username]', identifier); await fill('[name=password]', secret); await click('Sign in');
  await until(() => evaluate(`document.querySelector('.identity strong')?.textContent === ${JSON.stringify(user.name)}`), `sign in ${user.role}`);
  await until(() => evaluate(`!document.querySelector('.role-loading')`), 'orders loaded');
}
const scope = id => `document.querySelector('[data-order-id="${id}"]')`;
async function state(id, expected) { await until(() => repo.get(id)?.status === expected, `${id} ${expected}`); }
async function shot(name) { const scroll = await evaluate('window.scrollY'); await evaluate('window.scrollTo({top:0,behavior:"instant"})'); const image = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); await writeFile(join('test-results', name), Buffer.from(image.data, 'base64')); await evaluate(`window.scrollTo({top:${scroll},behavior:"instant"})`); }
async function auth(user) { const response = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password }) }); assert.equal(response.status, 200); return response.headers.get('set-cookie').split(';')[0]; }

try {
  startServer(); await until(async () => (await fetch(`${base}/api/session`)).ok, 'production server');
  assert.equal((await fetch(`${base}/api/orders`)).status, 401);
  assert.equal((await fetch(`${base}/api/session/demo`, { method: 'POST' })).status, 404, 'production ignores demo flag');
  const cookie = await auth(accounts.CUSTOMER);
  const mine = await (await fetch(`${base}/api/orders?customerId=${other.id}`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(mine.orders.map(order => order.id), [delivery.id]); assert.equal(mine.orders[0].history, undefined);
  assert.equal((await fetch(`${base}/api/orders/${hidden.id}`, { headers: { Cookie: cookie } })).status, 404);
  assert.equal((await fetch(`${base}/api/orders/${delivery.id}`, { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start_preparation', revision: 0, requestId: randomUUID() }) })).status, 403);
  browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${join(temporary, 'browser')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const debugPort = await until(async () => (await readFile(join(temporary, 'browser', 'DevToolsActivePort'), 'utf8')).split('\n')[0], 'headless browser');
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id) { const item = pending.get(message.id); if (item) { pending.delete(message.id); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); } } if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text); if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(arg => arg.value || arg.description).join(' ')); });
  await command('Runtime.enable'); await command('Page.enable'); await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: base }); await until(() => evaluate(`Boolean(document.querySelector('.auth-card'))`), 'login screen'); await mkdir('test-results', { recursive: true });
  await signIn(accounts.MANAGER); assert.equal(await evaluate(`document.querySelectorAll('.roles-header nav button:not(:disabled)').length`), 5); await shot('manager-view.png');
  await signIn(accounts.CHEF); assert.equal(await evaluate(`document.querySelectorAll('.roles-header nav button:not(:disabled)').length`), 1);
  await click('Online Orders'); await until(() => evaluate(`Boolean(${scope(delivery.id)})`), 'online chef ticket');
  await click('Reprioritize'); await until(() => evaluate(`!document.querySelector('.operation-error') && !document.querySelector('.chef-priority button').disabled`), 'authenticated priority fallback');
  await click('Start preparation', scope(delivery.id)); await state(delivery.id, 'PREPARING');
  await click('Finish preparation', scope(delivery.id)); await state(delivery.id, 'READY_TO_PACKAGE');
  await signIn(accounts.WAITER); await click('Online Orders'); await until(() => evaluate(`Boolean(${scope(delivery.id)})`), 'waiter packaging queue');
  await click('Start packaging', scope(delivery.id)); await state(delivery.id, 'PACKAGING'); await until(() => evaluate(`Boolean(document.querySelector('.waiter-packing'))`), 'embedded packing panel');
  const photo = (await readFile('tests/fixtures/vision/correct.png')).toString('base64');
  await evaluate(`(() => {const bytes=Uint8Array.from(atob(${JSON.stringify(photo)}),c=>c.charCodeAt(0));const file=new File([bytes],'packing.png',{type:'image/png'});const transfer=new DataTransfer();transfer.items.add(file);const input=document.querySelector('.photo-upload input');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(() => evaluate(`!document.querySelector('.packing-photo-actions button').disabled`), 'photo prepared'); await click('Check photo');
  await until(() => evaluate(`Boolean(document.querySelector('.verification-result.review_needed'))`), 'real missing-key fallback');
  await evaluate(`document.querySelectorAll('.waiter-packing .check-row input').forEach(input=>input.click())`);
  await click('Complete manual check'); await until(() => repo.get(delivery.id).verification?.result === 'manual_checked', 'server manual check');
  await until(() => evaluate(`!document.querySelector('.seal-check input').disabled`), 'packing confirmation unlocked');
  await evaluate(`document.querySelector('.seal-check input').click()`); await until(() => Boolean(repo.get(delivery.id).packingConfirmedAt), 'confirmation saved');
  await fill(`select[id="location-${delivery.id}"]`, 'Shelf A1'); await until(() => repo.get(delivery.id).handoffLocation === 'Shelf A1', 'location saved');
  await shot('waiter-packaging.png'); await click('Ready for driver pickup'); await state(delivery.id, 'READY_FOR_PICKUP');
  await signIn(accounts.DRIVER); await until(() => evaluate(`Boolean(${scope(delivery.id)})`), 'driver delivery');
  assert.equal(await evaluate(`document.querySelectorAll('.op-order .op-source').length > 0 && [...document.querySelectorAll('.op-source')].every(element=>element.textContent.includes('Delivery'))`), true);
  await click('Claim delivery', scope(delivery.id)); await until(() => repo.get(delivery.id).driverId === accounts.DRIVER.id, 'driver claim');
  const otherDriverCookie = await auth(driver2); assert.equal((await fetch(`${base}/api/orders/${delivery.id}`, { headers: { Cookie: otherDriverCookie } })).status, 404);
  await click('Mark picked up', scope(delivery.id)); await state(delivery.id, 'OUT_FOR_DELIVERY'); assert.equal(repo.get(delivery.id).completedAt, null); await shot('driver-view.png');
  await click('Mark delivered', scope(delivery.id)); await state(delivery.id, 'COMPLETED');
  await signIn(accounts.CUSTOMER); await until(() => evaluate(`Boolean(${scope(delivery.id)})`), 'customer delivery history'); assert.equal(await evaluate(`document.body.textContent.includes(${JSON.stringify(hidden.id)})`), false); assert.equal(await evaluate(`Boolean(document.querySelector('.customer-progress .done:last-child'))`), true); await shot('customer-view.png');
  // Customer ordering, including server-calculated total and options.
  await fill('[aria-label="Burger quantity"]', '1'); await fill('[aria-label="Salad quantity"]', '1'); await fill('[aria-label="Burger options"]', 'No cheese'); await click('Review complete · Submit order');
  await until(() => repo.list(accounts.CUSTOMER).length === 2, 'customer ordering');
  await signIn(accounts.WAITER); await evaluate(`document.querySelector('.create-order').open=true`); await fill('[aria-label="Burger quantity"]', '1'); await fill('[name=tableNumber]', '07'); await fill('[name=notes]', 'Dine-in smoke test'); await click('Review complete · Submit order');
  const dine = await until(() => repo.list(accounts.MANAGER).find(order=>order.notes === 'Dine-in smoke test'), 'waiter created dine-in'); assert.equal(dine.source, 'IN_PERSON'); assert.equal(dine.fulfillment, 'DINE_IN');
  await signIn(accounts.CHEF); await until(() => evaluate(`Boolean(${scope(dine.id)})`), 'dine-in kitchen ticket'); await click('Start preparation', scope(dine.id)); await state(dine.id, 'PREPARING'); await click('Finish preparation', scope(dine.id)); await state(dine.id, 'READY_TO_SERVE'); assert.equal(repo.get(dine.id).packagingStartedAt, null);
  await signIn(accounts.WAITER); await until(() => evaluate(`Boolean(${scope(dine.id)})`), 'ready-to-serve waiter ticket'); await click('Mark served', scope(dine.id)); await state(dine.id, 'COMPLETED');
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'responsive top menu'); await shot('roles-mobile.png');
  await signIn(accounts.MANAGER); await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false }); await click('Online Orders'); await shot('manager-completed.png');
  await stopServer(); startServer(); await until(async () => (await fetch(`${base}/api/session`)).ok, 'server restart');
  await command('Page.reload', { ignoreCache: true }); await until(() => evaluate(`document.querySelector('.identity strong')?.textContent === ${JSON.stringify(accounts.MANAGER.name)}`), 'persisted session after restart');
  assert.equal(repo.get(delivery.id).status, 'COMPLETED'); assert.ok(repo.get(delivery.id).history.some(entry=>entry.action === 'pickup')); assert.deepEqual(errors, [], 'no browser errors');
  for (const username of ['manager', 'customer', 'waiter', 'chef', 'driver']) {
    const fixed = repo.user(`fixed-${username}`);
    await signIn(fixed, username, 'password');
    assert.equal(await evaluate(`document.querySelector('.roles-header nav [aria-current="page"]').textContent.trim()`), fixed.name);
    assert.equal(await evaluate(`Boolean(document.querySelector('.fixed-account-banner'))`), true);
    assert.equal(await evaluate(`document.querySelectorAll('.roles-header nav button:not(:disabled)').length`), username === 'manager' ? 5 : 1);
  }
  await signIn(repo.user('fixed-manager'), 'manager', 'password');
  await stopServer(); startServer(); await until(async () => (await fetch(`${base}/api/session`)).ok, 'fixed session server restart');
  await command('Page.reload', { ignoreCache: true }); await until(() => evaluate(`document.querySelector('.identity strong')?.textContent === 'Manager'`), 'fixed account session survives restart');
  await shot('fixed-account-login.png');
  assert.deepEqual(errors, [], 'fixed account logins have no browser errors');
  console.log('PASS: all five fixed username/password logins in production; fixed sessions survive restart; existing custom accounts; five role views; real login/logout; development switcher disabled in production; direct API isolation; source tabs; chef preparation; waiter creation/packaging; driver claim/pickup/delivery; customer ordering/progress; dine-in served; mobile menu; SQLite persistence.');
  console.log('Screenshots: test-results/manager-view.png, waiter-packaging.png, driver-view.png, customer-view.png, roles-mobile.png, manager-completed.png');
} catch (error) {
  console.error(error);
  if (socket?.readyState === WebSocket.OPEN) {
    await mkdir('test-results', { recursive: true });
    await shot('roles-failure.png');
    console.error(await evaluate(`(async()=>({error:document.querySelector('[role=alert]')?.textContent,heading:document.querySelector('h1')?.textContent,identity:document.querySelector('.identity')?.textContent,session:await fetch('/api/session').then(r=>r.json()),button:document.querySelector('.auth-card button')?.textContent}))()`));
  }
  console.error(serverOutput.slice(-4000)); process.exitCode = 1;
}
finally { socket?.close(); browser?.kill(); await stopServer(); repo.db.close(); }
