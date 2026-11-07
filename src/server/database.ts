import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { DEFAULT_SETTINGS, orderSchema, settingsSchema, verificationSchema, type Settings } from "../lib/contracts";
import { ACTIONS, allowedActions, canReadOrder, createOrderSchema, MENU_PRICES, packingIsComplete, type OperationalOrder, type Role, type User, type Operation } from "../lib/operations";
import { CATALOG } from "../lib/catalog";
import { FIXED_ACCOUNTS, FIXED_PASSWORD } from "./fixedAccounts";

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export class Repository {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('MANAGER','CUSTOMER','WAITER','CHEF','DRIVER')), password_hash TEXT NOT NULL, salt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS login_attempts(email TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, source TEXT NOT NULL, source_order_id TEXT NOT NULL, customer_id TEXT REFERENCES users(id), fulfillment TEXT NOT NULL, status TEXT NOT NULL, driver_id TEXT REFERENCES users(id), revision INTEGER NOT NULL, created_at TEXT NOT NULL, document TEXT NOT NULL, UNIQUE(source,source_order_id));
      CREATE INDEX IF NOT EXISTS orders_customer ON orders(customer_id); CREATE INDEX IF NOT EXISTS orders_source_status ON orders(source,status);
      CREATE TABLE IF NOT EXISTS requests(user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, order_id TEXT NOT NULL REFERENCES orders(id), PRIMARY KEY(user_id,request_id));
      CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL);
      INSERT OR IGNORE INTO schema_migrations VALUES(1,datetime('now'));`);
    this.db.prepare("INSERT OR IGNORE INTO settings VALUES(1,?)").run(JSON.stringify(DEFAULT_SETTINGS));
    // Fixed identities must exist for order ownership/assignment foreign keys.
    // Login/session validation itself does not read or write this database.
    const salt = "passcheck-fixed-demo-accounts";
    const hash = scryptSync(FIXED_PASSWORD, salt, 64).toString("hex");
    const insertAccount = this.db.prepare("INSERT OR IGNORE INTO users VALUES(?,?,?,?,?,?)");
    for (const { user } of FIXED_ACCOUNTS) insertAccount.run(user.id, user.email, user.name, user.role, hash, salt);
  }
  user(id: string): User | undefined {
    return this.db.prepare("SELECT id,name,email,role FROM users WHERE id=?").get(id) as User | undefined;
  }
  users(role?: Role): User[] {
    return (role ? this.db.prepare("SELECT id,name,email,role FROM users WHERE role=? ORDER BY name").all(role) : this.db.prepare("SELECT id,name,email,role FROM users ORDER BY name").all()) as User[];
  }
  createUser(input: { id?: string; email: string; name: string; role: Role; password: string }): User {
    const email = z.email().parse(input.email.trim().toLowerCase());
    z.string().min(12).max(128).parse(input.password);
    z.enum(["MANAGER", "CUSTOMER", "WAITER", "CHEF", "DRIVER"]).parse(input.role);
    const salt = randomBytes(16).toString("hex");
    const user = { id: input.id ?? randomUUID(), email, name: z.string().trim().min(1).max(100).parse(input.name), role: input.role };
    this.db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run(user.id, email, user.name, user.role, scryptSync(input.password, salt, 64).toString("hex"), salt);
    return user;
  }
  login(email: string, password: string): User {
    email = email.trim().toLowerCase();
    const now = Date.now();
    const attempt = this.db.prepare("SELECT attempts,reset_at FROM login_attempts WHERE email=?").get(email) as { attempts: number; reset_at: number } | undefined;
    if (attempt && attempt.reset_at > now && attempt.attempts >= 8) throw new HttpError(429, "Too many sign-in attempts. Try again in 15 minutes.");
    const row = this.db.prepare("SELECT * FROM users WHERE email=?").get(email) as (User & { password_hash: string; salt: string }) | undefined;
    const actual = scryptSync(password, row?.salt ?? "invalid-account-salt", 64);
    if (!row || !timingSafeEqual(actual, Buffer.from(row.password_hash, "hex"))) {
      this.db.prepare("INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(email) DO UPDATE SET attempts=CASE WHEN reset_at < ? THEN 1 ELSE attempts+1 END, reset_at=CASE WHEN reset_at < ? THEN excluded.reset_at ELSE reset_at END").run(email, now + 900_000, now, now);
      throw new HttpError(401, "Email or password is incorrect");
    }
    this.db.prepare("DELETE FROM login_attempts WHERE email=?").run(email);
    return this.user(row.id)!;
  }
  session(userId: string): string {
    const token = randomBytes(32).toString("hex");
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
    this.db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(hashToken(token), userId, Date.now() + 8 * 60 * 60_000);
    return token;
  }
  sessionUser(token?: string): User | undefined {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return;
    return this.db.prepare("SELECT u.id,u.name,u.email,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?").get(hashToken(token), Date.now()) as User | undefined;
  }
  logout(token: string) { this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hashToken(token)); }
  get(id: string): OperationalOrder | undefined {
    const row = this.db.prepare("SELECT document FROM orders WHERE id=?").get(id) as { document: string } | undefined;
    return row ? JSON.parse(row.document) : undefined;
  }
  list(user: User, filters: { source?: string; status?: string; fulfillment?: string; date?: string; customerId?: string } = {}) {
    let sql = "SELECT document FROM orders WHERE 1=1";
    const args: string[] = [];
    if (user.role === "CUSTOMER") { sql += " AND customer_id=?"; args.push(user.id); }
    if (user.role === "DRIVER") { sql += " AND fulfillment='DELIVERY' AND (driver_id IS NULL OR driver_id=?)"; args.push(user.id); }
    if (user.role === "MANAGER" && filters.customerId) { sql += " AND customer_id=?"; args.push(filters.customerId); }
    for (const key of ["source", "status", "fulfillment"] as const) if (filters[key]) { sql += ` AND ${key}=?`; args.push(filters[key]!); }
    if (filters.date) { sql += " AND substr(created_at,1,10)=?"; args.push(filters.date); }
    return this.db.prepare(sql + " ORDER BY created_at,id").all(...args).map(row => JSON.parse(row.document as string) as OperationalOrder);
  }
  read(user: User, id: string) {
    const order = this.get(id);
    if (!order || !canReadOrder(user, order)) throw new HttpError(404, "Order not found");
    return order;
  }
  settings() { return JSON.parse(this.db.prepare("SELECT document FROM settings WHERE id=1").get()!.document as string) as Settings; }
  updateSettings(user: User, settings: unknown) {
    if (user.role !== "MANAGER") throw new HttpError(403, "Only managers can change restaurant preferences");
    const parsed = settingsSchema.parse(settings);
    this.db.prepare("UPDATE settings SET document=? WHERE id=1").run(JSON.stringify(parsed));
    return parsed;
  }
  private insert(order: OperationalOrder) {
    this.db.prepare("INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?)").run(order.id, order.source, order.sourceOrderId, order.customerId, order.fulfillment, order.status, order.driverId, order.revision, order.createdAt, JSON.stringify(order));
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private replay(user: User, requestId: string, fingerprint: string) {
    const prior = this.db.prepare("SELECT fingerprint,order_id FROM requests WHERE user_id=? AND request_id=?").get(user.id, requestId) as { fingerprint: string; order_id: string } | undefined;
    if (!prior) return;
    if (prior.fingerprint !== fingerprint) throw new HttpError(409, "This request ID was already used for a different action");
    return this.read(user, prior.order_id);
  }
  private remember(user: User, requestId: string, fingerprint: string, orderId: string) {
    this.db.prepare("INSERT INTO requests VALUES(?,?,?,?)").run(user.id, requestId, fingerprint, orderId);
  }
  create(user: User, input: unknown, requestId: string): OperationalOrder {
    if (!["MANAGER", "CUSTOMER", "WAITER"].includes(user.role)) throw new HttpError(403, "This role cannot create orders");
    z.uuid().parse(requestId);
    const data = createOrderSchema.parse(input);
    if (user.role === "CUSTOMER" && (data.source !== "ONLINE" || (data.customerId && data.customerId !== user.id))) throw new HttpError(403, "Customers can place only their own online orders");
    if (user.role === "WAITER" && data.source !== "IN_PERSON") throw new HttpError(403, "Waiter orders must be in-person");
    const customerId = user.role === "CUSTOMER" ? user.id : data.customerId ?? null;
    const customer = customerId ? this.user(customerId) : undefined;
    if (customerId && customer?.role !== "CUSTOMER") throw new HttpError(400, "Choose a valid customer account");
    const fingerprint = JSON.stringify(["create", data]);
    return this.transaction(() => {
      const prior = this.replay(user, requestId, fingerprint); if (prior) return prior;
      const at = new Date().toISOString();
      const id = `PC-${randomBytes(4).toString("hex").toUpperCase()}`;
      const items = data.items.map(item => ({ ...item, name: CATALOG[item.menuItemId].name, unitPriceCents: MENU_PRICES[item.menuItemId] }));
      const order: OperationalOrder = {
        id, sourceOrderId: id, source: data.source, fulfillment: data.fulfillment,
        customerId, customerName: customer?.name ?? (data.customerName || "Guest"), createdBy: user.id, createdByName: user.name,
        chefId: null, chefName: null, driverId: null, driverName: null, tableNumber: data.fulfillment === "DINE_IN" ? data.tableNumber : null,
        deliveryAddress: data.fulfillment === "DELIVERY" ? data.deliveryAddress : "", contact: data.contact, notes: data.notes,
        items, totalCents: items.reduce((total, item) => total + item.quantity * item.unitPriceCents, 0),
        status: "PLACED", revision: 0, createdAt: at, updatedAt: at, startedAt: null, cookedAt: null, packagingStartedAt: null,
        packingConfirmedAt: null, readyAt: null, pickedUpAt: null, completedAt: null, cancelledAt: null,
        handoffLocation: null, pickupCode: null, latestScanId: null, verification: null,
        history: [{ previousStatus: null, newStatus: "PLACED", at, actorId: user.id, actorName: user.name, action: "create" }],
      };
      this.insert(order); this.remember(user, requestId, fingerprint, id); return order;
    });
  }
  action(user: User, id: string, input: { action: Operation; revision: number; requestId: string; scanId?: string; verification?: unknown; confirmed?: boolean; location?: string; userId?: string; reason?: string; deliveryAddress?: string; contact?: string }): OperationalOrder {
    const fingerprint = JSON.stringify([id, input]);
    return this.transaction(() => {
      const prior = this.replay(user, input.requestId, fingerprint); if (prior) return prior;
      const order = this.read(user, id);
      if (order.revision !== input.revision) throw new HttpError(409, "This order changed. Refresh and try again.");
      if (!ACTIONS.includes(input.action) || !allowedActions(user, order).includes(input.action)) throw new HttpError(403, "Action is not permitted for this role and order stage");
      const at = new Date().toISOString();
      const next = structuredClone(order);
      switch (input.action) {
        case "start_preparation": next.status = "PREPARING"; next.startedAt = at; next.chefId = user.id; next.chefName = user.name; break;
        case "finish_preparation": next.cookedAt = at; next.status = order.fulfillment === "DINE_IN" ? "READY_TO_SERVE" : "READY_TO_PACKAGE"; if (order.fulfillment === "DINE_IN") next.readyAt = at; break;
        case "start_packaging": next.status = "PACKAGING"; next.packagingStartedAt = at; break;
        case "scan_started":
          if (!input.scanId) throw new HttpError(400, "Scan ID is required");
          next.latestScanId = input.scanId; next.verification = null; next.packingConfirmedAt = null; break;
        case "verification": {
          const value = verificationSchema.parse(input.verification);
          if (value.orderId !== id || value.scanId !== order.latestScanId) throw new HttpError(409, "This check is no longer current");
          // A browser cannot assert a live AI match. The vision route records provider results itself.
          if (value.result !== "manual_checked" && value.result !== "review_needed") throw new HttpError(403, "Photo results must come from the server vision check");
          next.verification = { ...value, checkedAt: at }; next.packingConfirmedAt = null; break;
        }
        case "confirm_packing":
          next.packingConfirmedAt = input.confirmed ? at : null;
          if (input.confirmed && !packingIsComplete({ ...next, handoffLocation: "Shelf A1" })) throw new HttpError(409, "Complete a valid item check first");
          break;
        case "location": if (!["Shelf A1", "Shelf A2"].includes(input.location ?? "")) throw new HttpError(400, "Choose Shelf A1 or Shelf A2"); next.handoffLocation = input.location!; break;
        case "delivery_details": if (!input.deliveryAddress?.trim()) throw new HttpError(400, "Delivery address is required"); next.deliveryAddress = input.deliveryAddress; next.contact = input.contact ?? order.contact; break;
        case "finish_packaging": if (!packingIsComplete(order)) throw new HttpError(409, "Complete the check, confirm packing, and choose a location"); next.status = "READY_FOR_PICKUP"; next.readyAt = at; next.pickupCode = `P-${id.slice(3)}`; break;
        case "serve": next.status = "COMPLETED"; next.completedAt = at; break;
        case "collect": next.status = "COMPLETED"; next.pickedUpAt = at; next.completedAt = at; break;
        case "claim": {
          if (user.role === "MANAGER") throw new HttpError(400, "Managers must assign a driver account");
          next.driverId = user.id; next.driverName = user.name; break;
        }
        case "assign_driver": {
          const driver = input.userId ? this.user(input.userId) : undefined;
          if (driver?.role !== "DRIVER") throw new HttpError(400, "Select a driver account");
          next.driverId = driver.id; next.driverName = driver.name; break;
        }
        case "associate_customer": {
          const customer = input.userId ? this.user(input.userId) : undefined;
          if (customer?.role !== "CUSTOMER") throw new HttpError(400, "Select a customer account");
          next.customerId = customer.id; next.customerName = customer.name; break;
        }
        case "pickup": if (!packingIsComplete(order) || !order.deliveryAddress) throw new HttpError(409, "Packaging and a delivery address are required before pickup"); next.status = "OUT_FOR_DELIVERY"; next.pickedUpAt = at; break;
        case "deliver": next.status = "COMPLETED"; next.completedAt = at; break;
        case "cancel": if (!input.reason) throw new HttpError(400, "A cancellation reason is required"); next.status = "CANCELLED"; next.cancelledAt = at; break;
      }
      next.revision++; next.updatedAt = at;
      next.history.push({ previousStatus: order.status, newStatus: next.status, at, actorId: user.id, actorName: user.name, action: input.action, ...(input.reason ? { note: input.reason } : {}) });
      this.save(next, order.revision); this.remember(user, input.requestId, fingerprint, id); return next;
    });
  }
  private save(order: OperationalOrder, revision: number) {
    const result = this.db.prepare("UPDATE orders SET customer_id=?,status=?,driver_id=?,revision=?,document=? WHERE id=? AND revision=?").run(order.customerId, order.status, order.driverId, order.revision, JSON.stringify(order), order.id, revision);
    if (result.changes !== 1) throw new HttpError(409, "Order changed concurrently");
  }
  recordVision(user: User, id: string, scanId: string, verification: OperationalOrder["verification"]) {
    return this.transaction(() => {
      const order = this.read(user, id);
      if (!["MANAGER", "WAITER"].includes(user.role) || order.status !== "PACKAGING" || order.latestScanId !== scanId) throw new HttpError(409, "This photo check is no longer current");
      const next = { ...order, verification: verification ? { ...verification, checkedAt: new Date().toISOString() } : null, packingConfirmedAt: null, revision: order.revision + 1, updatedAt: new Date().toISOString() };
      this.save(next, order.revision); return next;
    });
  }
  importLegacy(user: User, input: unknown) {
    if (user.role !== "MANAGER") throw new HttpError(403, "Only a manager can import legacy orders");
    const orders = z.array(orderSchema).max(100).parse(input);
    return this.transaction(() => {
      let imported = 0;
      for (const legacy of orders) {
        const source = legacy.source === "waiter" ? "IN_PERSON" : "ONLINE";
        if (this.db.prepare("SELECT id FROM orders WHERE id=? OR (source=? AND source_order_id=?)").get(legacy.id, source, legacy.sourceOrderId)) continue;
        const dine = legacy.fulfillment === "dine_in";
        const status = legacy.status === "queued" ? "PLACED" : legacy.status === "cooking" ? "PREPARING" : legacy.status === "collected" ? legacy.fulfillment === "delivery" ? "OUT_FOR_DELIVERY" : "COMPLETED" : dine ? "READY_TO_SERVE" : "READY_TO_PACKAGE";
        const at = new Date().toISOString();
        const items = legacy.items.map(item => ({ ...item, options: [], notes: "", unitPriceCents: null }));
        this.insert({ id: legacy.id, sourceOrderId: legacy.sourceOrderId, source, fulfillment: dine ? "DINE_IN" : legacy.fulfillment === "takeaway" ? "TAKEAWAY" : "DELIVERY", customerId: null, customerName: "Unassociated legacy customer", createdBy: "legacy", createdByName: "Unknown (legacy)", chefId: null, chefName: null, driverId: null, driverName: null,
          tableNumber: legacy.tableNumber, deliveryAddress: "", contact: "", notes: "Imported legacy demo. Historical prices, totals, destination and staff identities were unavailable. Confirm delivery details before dispatch.",
          items, totalCents: null, status, revision: 0, createdAt: legacy.createdAt, updatedAt: at,
          startedAt: legacy.startedAt, cookedAt: legacy.cookedAt, packagingStartedAt: null, packingConfirmedAt: null, readyAt: dine ? legacy.readyAt : null, pickedUpAt: legacy.collectedAt, completedAt: dine ? legacy.collectedAt : null, cancelledAt: null, handoffLocation: null, pickupCode: null, latestScanId: null, verification: null,
          history: [{ previousStatus: null, newStatus: status, at, actorId: user.id, actorName: user.name, action: "legacy_import", note: `Imported saved status ${legacy.status}. Earlier history, ownership, prices and staff identities are unavailable. Non-dine-in packing checks require a fresh check; collected delivery is not proof of delivery.` }],
        }); imported++;
      }
      return imported;
    });
  }
  seedDemo(reset = false) {
    for (const [id, name, role] of [
      ["demo-manager", "Morgan Manager", "MANAGER"], ["demo-customer", "Alex Customer", "CUSTOMER"],
      ["demo-customer-other", "Jamie Customer", "CUSTOMER"], ["demo-waiter", "Wren Waiter", "WAITER"],
      ["demo-chef", "Casey Chef", "CHEF"], ["demo-driver", "Devin Driver", "DRIVER"], ["demo-driver-other", "Drew Driver", "DRIVER"],
    ] as const) if (!this.user(id)) this.createUser({ id, name, role, email: `${id}@passcheck.invalid`, password: randomBytes(32).toString("hex") });
    if (reset) this.transaction(() => { this.db.exec("DELETE FROM requests; DELETE FROM orders;"); this.db.prepare("UPDATE settings SET document=? WHERE id=1").run(JSON.stringify(DEFAULT_SETTINGS)); });
    if ((this.db.prepare("SELECT count(*) AS count FROM orders").get()!.count as number) > 0) return;
    for (let i = 0; i < 6; i++) {
      const waiter = this.user("demo-waiter")!;
      const customer = this.user(i % 2 ? "demo-customer-other" : "demo-customer")!;
      this.create(i % 2 ? waiter : customer, {
        source: i % 2 ? "IN_PERSON" : "ONLINE", fulfillment: ["DELIVERY", "DINE_IN", "TAKEAWAY"][i % 3],
        customerId: customer.id, tableNumber: String(i + 1), deliveryAddress: "100 Demo Street, Pittsburgh, PA", contact: "Demo contact — confirm in person",
        notes: "Seeded development order", items: [{ menuItemId: ["burger", "fries", "milkshake", "salad"][i % 4], quantity: 1 }, { menuItemId: ["burger", "fries", "milkshake", "salad"][(i + 1) % 4], quantity: 1 }],
      }, randomUUID());
    }
  }
}

const globalDb = globalThis as unknown as { passcheckRepository?: Repository };
export function getRepository() { return globalDb.passcheckRepository ??= new Repository(process.env.PASSCHECK_DATABASE_PATH || resolve("data/passcheck.sqlite")); }
