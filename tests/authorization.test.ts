import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { getRepository } from "../src/server/database";
import { GET, POST } from "../src/app/api/orders/route";
import { GET as read, PATCH } from "../src/app/api/orders/[id]/route";
import { GET as users } from "../src/app/api/users/route";
import { POST as prioritize } from "../src/app/api/prioritize/route";
import { POST as verify } from "../src/app/api/verify/route";
import { POST as demo } from "../src/app/api/session/demo/route";
import { POST as login, DELETE as logout } from "../src/app/api/session/route";
import type { User } from "../src/lib/operations";
import { checkOrigin } from "../src/server/http";

process.env.PASSCHECK_DATABASE_PATH = ":memory:";
const repo = getRepository();
const customer = repo.createUser({ email: "customer@test.example", name: "Customer", role: "CUSTOMER", password: "test-only-password" });
const other = repo.createUser({ email: "other@test.example", name: "Other", role: "CUSTOMER", password: "test-only-password" });
const chef = repo.createUser({ email: "chef@test.example", name: "Chef", role: "CHEF", password: "test-only-password" });
function request(path: string, user?: User, method = "GET", value?: unknown, origin?: string) {
  return new Request(`http://localhost${path}`, { method, headers: { "Content-Type": "application/json", ...(user ? { cookie: `passcheck_session=${repo.session(user.id)}` } : {}), ...(origin ? { Origin: origin } : {}) }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
function create(user: User) { return repo.create(user, { source: "ONLINE", fulfillment: "TAKEAWAY", items: [{ menuItemId: "milkshake", quantity: 1 }] }, randomUUID()); }

test("orders, staff directory and AI routes reject missing sessions before processing bodies", async () => {
  assert.equal((await GET(request("/api/orders"))).status, 401);
  assert.equal((await users(request("/api/users"))).status, 401);
  assert.equal((await prioritize(request("/api/prioritize", undefined, "POST", {}))).status, 401);
  assert.equal((await verify(request("/api/verify", undefined, "POST", {}))).status, 401);
});
test("customers cannot bypass ownership using list filters, IDs, role fields or staff endpoints", async () => {
  const mine = create(customer); const theirs = create(other);
  const response = await GET(request(`/api/orders?customerId=${other.id}`, customer));
  const result = await response.json(); assert.ok(result.orders.some((order: { id: string }) => order.id === mine.id)); assert.ok(!result.orders.some((order: { id: string }) => order.id === theirs.id));
  const own = result.orders.find((order: { id: string }) => order.id === mine.id); assert.equal(own.history, undefined); assert.equal(own.createdBy, undefined);
  assert.equal((await read(request(`/api/orders/${theirs.id}`, customer), { params: Promise.resolve({ id: theirs.id }) })).status, 404);
  assert.equal((await PATCH(request(`/api/orders/${mine.id}`, customer, "PATCH", { role: "MANAGER", action: "start_preparation", revision: 0, requestId: randomUUID() }), { params: Promise.resolve({ id: mine.id }) })).status, 403);
  assert.equal((await users(request("/api/users", customer))).status, 403);
  assert.equal((await verify(request("/api/verify", customer, "POST", {}))).status, 403);
  assert.equal((await prioritize(request("/api/prioritize", customer, "POST", {}))).status, 403);
});
test("server ignores client totals and statuses; only permitted creation roles can submit", async () => {
  const payload = { requestId: randomUUID(), order: { source: "ONLINE", fulfillment: "TAKEAWAY", totalCents: 1, status: "COMPLETED", items: [{ menuItemId: "burger", quantity: 2 }] } };
  const response = await POST(request("/api/orders", customer, "POST", payload)); assert.equal(response.status, 200);
  const { order } = await response.json(); assert.equal(order.totalCents, 1800); assert.equal(order.status, "PLACED");
  assert.equal((await POST(request("/api/orders", chef, "POST", payload))).status, 403);
  assert.equal((await POST(request("/api/orders", customer, "POST", payload, "https://attacker.example"))).status, 403);
});
test("login sets HttpOnly SameSite cookie, rejects bad credentials and logout invalidates it", async () => {
  const failure = await login(request("/api/session", undefined, "POST", { email: customer.email, password: "bad" })); assert.equal(failure.status, 401);
  const success = await login(request("/api/session", undefined, "POST", { email: customer.email, password: "test-only-password" })); assert.equal(success.status, 200);
  const cookie = success.headers.get("set-cookie")!; assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=strict/i);
  const loggedOut = await logout(new Request("http://localhost/api/session", { method: "DELETE", headers: { cookie: cookie.split(";")[0] } })); assert.equal(loggedOut.status, 200);
  assert.equal((await GET(new Request("http://localhost/api/orders", { headers: { cookie: cookie.split(";")[0] } }))).status, 401);
});
test("demo identity endpoint is unavailable in production even if its flag is set", async () => {
  repo.seedDemo();
  const demoCookie = `passcheck_session=${repo.session("demo-manager")}`;
  const previous = { NODE_ENV: process.env.NODE_ENV, PASSCHECK_DEMO_MODE: process.env.PASSCHECK_DEMO_MODE };
  Object.assign(process.env, { NODE_ENV: "production", PASSCHECK_DEMO_MODE: "true" });
  try {
    assert.equal((await demo(request("/api/session/demo", undefined, "POST", { userId: "demo-manager" }))).status, 404);
    assert.equal((await GET(new Request("http://localhost/api/orders", { headers: { cookie: demoCookie } }))).status, 401, "persisted development sessions grant no production access");
  }
  finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test("same-origin checks use the browser Host when Next normalizes the internal URL", () => {
  assert.doesNotThrow(() => checkOrigin(new Request("http://localhost:3000/api/session", { headers: { Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000" } })));
  assert.throws(() => checkOrigin(new Request("http://localhost:3000/api/session", { headers: { Host: "127.0.0.1:3000", Origin: "https://attacker.example" } })));
});
