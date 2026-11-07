import assert from "node:assert/strict";
import test from "node:test";
import { authenticateFixedAccount, createFixedSession, FIXED_ACCOUNTS, fixedSessionUser } from "../src/server/fixedAccounts";
import { GET, POST, DELETE } from "../src/app/api/session/route";
import { requireUser } from "../src/server/http";
import { GET as staffDirectory } from "../src/app/api/users/route";
import { HttpError } from "../src/server/database";

const request = (value: unknown) => new Request("https://passcheck.example/api/session", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://passcheck.example" }, body: JSON.stringify(value) });

test("all five fixed usernames accept password and retain their server-defined roles", () => {
  assert.equal(FIXED_ACCOUNTS.length, 5);
  for (const { username, user } of FIXED_ACCOUNTS) {
    assert.deepEqual(authenticateFixedAccount(username, "password"), user);
    assert.deepEqual(authenticateFixedAccount(`  ${username.toUpperCase()}  `, "password"), user);
    for (const invalid of ["", "Password", "wrong-password"]) assert.equal(authenticateFixedAccount(username, invalid), undefined);
  }
  assert.equal(authenticateFixedAccount("administrator", "password"), undefined);
});
test("fixed sessions expire, reject tampering and unknown IDs, and preserve assigned roles", () => {
  const user = FIXED_ACCOUNTS[1].user; const now = Date.now(); const token = createFixedSession(user, now);
  assert.deepEqual(fixedSessionUser(token, now), user);
  assert.equal(fixedSessionUser(token, now + 8 * 60 * 60_000), undefined);
  const parts = token.split(".");
  const changed = Buffer.from(JSON.stringify({ id: "fixed-manager", expiresAt: Math.floor(now / 1000) + 3600 })).toString("base64url");
  assert.equal(fixedSessionUser(`${parts[0]}.${changed}.${parts[2]}`, now), undefined);
  assert.equal(fixedSessionUser(`${token}invalid`, now), undefined);
  assert.equal(fixedSessionUser("fixed1.invalid.invalid", now), undefined);
  assert.throws(() => createFixedSession({ ...user, id: "some-other-user" }));
});
test("fixed logins, session refresh and logout work in production without creating a database", async () => {
  const oldEnvironment = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: "production" });
  try {
    for (const { username, user } of FIXED_ACCOUNTS) {
      const response = await POST(request({ username, password: "password", role: "MANAGER" }));
      assert.equal(response.status, 200); assert.deepEqual((await response.json()).user, user);
      const cookie = response.headers.get("set-cookie")!;
      assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i); assert.match(cookie, /SameSite=strict/i);
      const nextRequest = new Request("https://passcheck.example/api/session", { headers: { cookie: cookie.split(";")[0] } });
      assert.deepEqual((await (await GET(nextRequest)).json()).user, user);
      assert.deepEqual(requireUser(nextRequest), user);
      if (user.role === "CUSTOMER") {
        assert.throws(() => requireUser(nextRequest, ["MANAGER"]), (error: unknown) => error instanceof HttpError && error.status === 403);
        assert.equal((await staffDirectory(nextRequest)).status, 403);
      }
      const logout = await DELETE(new Request("https://passcheck.example/api/session", { method: "DELETE", headers: { cookie: cookie.split(";")[0] } }));
      assert.equal(logout.status, 200); assert.match(logout.headers.get("set-cookie")!, /Max-Age=0/i);
    }
    assert.equal((globalThis as { passcheckRepository?: unknown }).passcheckRepository, undefined, "fixed account authentication never initializes SQLite");
  } finally { if (oldEnvironment === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: oldEnvironment }); }
});
test("invalid fixed credentials fail, including username supplied through the legacy email field", async () => {
  assert.equal((await POST(request({ username: "manager", password: "incorrect" }))).status, 401);
  assert.equal((await POST(request({ username: "unknown", password: "password" }))).status, 401);
  assert.equal((await POST(request({ username: "customer", password: "Password" }))).status, 401);
  assert.equal((await POST(request({ username: "manager" }))).status, 400);
  assert.equal((await POST(request({ password: "password" }))).status, 400);
  assert.equal((await POST(request({ email: "manager", password: "password" }))).status, 200);
});
