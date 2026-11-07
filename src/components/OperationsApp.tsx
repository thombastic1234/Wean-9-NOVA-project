"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/apiClient";
import { DEFAULT_SETTINGS, type Settings, type PriorityResponse } from "@/lib/contracts";
import { makePriorityRequest, fallbackRanking } from "@/lib/priority";
import { allowedActions, canViewRole, FULFILLMENTS, FULFILLMENT_LABELS, formatMoney, progressSteps, ROLES, SOURCE_LABELS, SOURCES, STATUSES, STATUS_LABELS, toPackingOrder, type Operation, type OperationalOrder, type Role, type User } from "@/lib/operations";
import { OrderForm } from "./OrderForm";
import { PriorityControls } from "./PriorityControls";
import { ServerPackingPanel } from "./ServerPackingPanel";

const label = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();
const time = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";
const actionLabels: Partial<Record<Operation, string>> = { start_preparation: "Start preparation", finish_preparation: "Finish preparation", start_packaging: "Start packaging", serve: "Mark served", collect: "Mark collected", claim: "Claim delivery", pickup: "Mark picked up", deliver: "Mark delivered" };
const descriptions: Record<Role, string> = {
  MANAGER: "Every order, every stage, and a clear record of each handoff.", CUSTOMER: "Place an order and follow its progress, from the kitchen to you.",
  WAITER: "Take orders, check packages, and keep service moving.", CHEF: "Prepare each ticket and send it to the right next step.", DRIVER: "Claim a delivery, follow its progress, and confirm every handoff.",
};
type AccountOption = Pick<User, "id" | "name" | "role">;

export function OperationsApp() {
  const [user, setUser] = useState<User | null>(null); const [sessionLoading, setSessionLoading] = useState(true);
  const [demo, setDemo] = useState(false); const [view, setView] = useState<Role>("CUSTOMER");
  const [source, setSource] = useState<typeof SOURCES[number]>("IN_PERSON");
  const [orders, setOrders] = useState<OperationalOrder[]>([]); const [users, setUsers] = useState<AccountOption[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS); const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(""); const [fulfillment, setFulfillment] = useState(""); const [date, setDate] = useState("");
  const [customerId, setCustomerId] = useState(""); const [packingId, setPackingId] = useState<string | null>(null);
  const [ranking, setRanking] = useState<PriorityResponse | null>(null); const priorityVersion = useRef(0);
  const [clock, setClock] = useState(Date.now()); const mutation = useRef(false);
  const identity = useRef(0);
  const queryKey = `${user?.id}:${source}:${view}:${status}:${fulfillment}:${date}:${customerId}`;
  const queryKeyRef = useRef(queryKey); queryKeyRef.current = queryKey;
  const renderIdentity = identity.current;
  const rememberUser = (account: User | null) => {
    identity.current++; setUser(account); setOrders([]); setUsers([]); setError(""); setNotice(""); setStatus(""); setFulfillment(""); setDate(""); setCustomerId(""); setPackingId(null); setRanking(null);
    if (account) { setView(account.role); setSource(account.role === "CUSTOMER" || account.role === "DRIVER" ? "ONLINE" : "IN_PERSON"); }
  };
  useEffect(() => { void api<{ user: User | null; demoEnabled: boolean }>("/api/session").then(result => { rememberUser(result.user); setDemo(result.demoEnabled); }).catch(err => setError(err.message)).finally(() => setSessionLoading(false)); }, []);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 30_000); return () => clearInterval(timer); }, []);

  const load = useCallback(async (quiet = false) => {
    if (!user) return; const currentIdentity = identity.current; const currentQuery = queryKeyRef.current;
    if (!quiet) setLoading(true);
    try {
      const query = new URLSearchParams({ source });
      if (view === "MANAGER") { if (status) query.set("status", status); if (fulfillment) query.set("fulfillment", fulfillment); if (date) query.set("date", date); }
      if (view === "CUSTOMER" && user.role === "MANAGER") query.set("customerId", customerId || "no-customer-selected");
      const result = await api<{ orders: OperationalOrder[] }>(`/api/orders?${query}`);
      if (currentIdentity !== identity.current || currentQuery !== queryKeyRef.current) return;
      setOrders(current => result.orders.map(order => { const existing = current.find(value => value.id === order.id); return existing && existing.revision > order.revision ? existing : order; }));
      setError("");
    } catch (err) { if (currentIdentity === identity.current) setError(err instanceof Error ? err.message : "Could not load orders"); }
    finally { if (currentIdentity === identity.current && !quiet) setLoading(false); }
  }, [user, source, view, status, fulfillment, date, customerId]);
  useEffect(() => { setOrders([]); setRanking(null); void load(); const interval = setInterval(() => void load(true), 4_000); return () => clearInterval(interval); }, [load]);
  useEffect(() => {
    if (!user) return;
    const currentIdentity = identity.current;
    if (user.role === "MANAGER" || user.role === "WAITER") void api<{ users: AccountOption[] }>("/api/users").then(result => { if (identity.current === currentIdentity) setUsers(result.users); }).catch(err => setError(err.message));
    if (user.role === "MANAGER" || user.role === "CHEF") void api<{ settings: Settings }>("/api/settings").then(result => { if (identity.current === currentIdentity) setSettings(result.settings); }).catch(err => setError(err.message));
  }, [user]);
  function receiveOrder(order: OperationalOrder) {
    if (renderIdentity !== identity.current) return;
    setOrders(current => {
      if (order.source !== source) return current;
      const existing = current.find(value => value.id === order.id);
      if (existing && existing.revision > order.revision) return current;
      return existing ? current.map(value => value.id === order.id ? order : value) : [...current, order];
    });
  }
  async function run(key: string, work: () => Promise<unknown>) {
    if (mutation.current) return; mutation.current = true; setBusy(key); setError(""); setNotice("");
    try { await work(); } catch (err) { setError(err instanceof Error ? err.message : "Action could not be completed"); await load(true); }
    finally { mutation.current = false; setBusy(null); }
  }
  async function act(order: OperationalOrder, action: Operation, payload: object = {}) {
    await run(order.id, async () => {
      const result = await api<{ order: OperationalOrder }>(`/api/orders/${order.id}`, { method: "PATCH", body: JSON.stringify({ action, revision: order.revision, requestId: crypto.randomUUID(), ...payload }) });
      receiveOrder(result.order); setNotice(`${order.id}: ${STATUS_LABELS[result.order.status]}`);
      if (action === "start_packaging") setPackingId(order.id);
    });
  }
  const packingOrders = orders.filter(order => order.status === "PACKAGING");
  const selectedPacking = packingOrders.find(order => order.id === packingId) ?? packingOrders[0];
  useEffect(() => { if (packingId) document.getElementById("waiter-packaging")?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [packingId]);
  const active = orders.filter(order => !["COMPLETED", "CANCELLED"].includes(order.status));
  const completed = orders.filter(order => ["COMPLETED", "CANCELLED"].includes(order.status));
  const queued = orders.filter(order => order.status === "PLACED");
  const request = makePriorityRequest(queued.map(toPackingOrder), settings, priorityVersion.current, clock);
  const signature = JSON.stringify([user?.id, source, settings, queued.map(order => [order.id, order.revision])]);
  const signatureRef = useRef(signature);
  if (signatureRef.current !== signature) { signatureRef.current = signature; priorityVersion.current++; }
  const currentRanking = ranking?.requestVersion === priorityVersion.current ? ranking : fallbackRanking(request);

  function card(order: OperationalOrder, customer = false) {
    const actions = allowedActions(user!, order).filter(action => action in actionLabels);
    const steps = progressSteps(order); const index = steps.indexOf(order.status);
    return <article className={`op-order status-${order.status.toLowerCase()}`} key={order.id} data-order-id={order.id}>
      <div className="op-order-heading"><div><h3>{order.id}</h3><span className="op-source">{order.source === "IN_PERSON" ? "In person" : "Online"} · {FULFILLMENT_LABELS[order.fulfillment]}{order.tableNumber ? ` · Table ${order.tableNumber}` : ""}</span></div><span className={`status-badge ${order.status.toLowerCase()}`}>{STATUS_LABELS[order.status]}</span></div>
      <div className="order-time">Placed {time(order.createdAt)}{!customer && ` · ${Math.max(0, Math.floor((clock - Date.parse(order.createdAt)) / 60_000))}m elapsed`}</div>
      <ul className="op-items">{order.items.map(item => <li key={item.menuItemId}><div><strong>{item.quantity} × {item.name}</strong>{item.options?.length > 0 && <small>Options: {item.options.join(", ")}</small>}{item.notes && <small>Prep: {item.notes}</small>}</div>{customer && <span>{item.unitPriceCents == null ? "Price unavailable" : formatMoney(item.quantity * item.unitPriceCents)}</span>}</li>)}</ul>
      {order.notes && <p className="order-notes"><b>Notes:</b> {order.notes}</p>}
      {customer ? <><div className="order-total">Total <strong>{order.totalCents == null ? "Historical total unavailable" : formatMoney(order.totalCents)}</strong></div>{order.status === "CANCELLED" ? <p className="cancelled-message">This order was cancelled.</p> : <ol className="customer-progress" aria-label="Order progress">{steps.map((step, i) => <li key={step} className={i <= index ? "done" : ""} aria-current={i === index ? "step" : undefined}><span>{i < index ? "✓" : i + 1}</span>{step === "COMPLETED" ? order.fulfillment === "DELIVERY" ? "Delivered" : order.fulfillment === "DINE_IN" ? "Served" : "Collected" : STATUS_LABELS[step]}</li>)}</ol>}</> : <>
        {order.customerName && <p className="order-person">Customer: {order.customerName}{order.createdByName && ` · Entered by ${order.createdByName}`}</p>}
        {order.chefName && <p className="order-person">Chef: {order.chefName}</p>}
        {order.fulfillment === "DELIVERY" && <div className="delivery-info"><p><b>Driver:</b> {order.driverName || "Unassigned"}</p>{order.deliveryAddress && <p><b>Destination:</b> {order.deliveryAddress}</p>}{order.contact && <p><b>Contact:</b> {order.contact}</p>}{order.pickedUpAt && <p><b>Picked up:</b> {time(order.pickedUpAt)}</p>}</div>}
        {allowedActions(user!, order).includes("delivery_details") && !order.deliveryAddress && <form className="missing-address" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void act(order, "delivery_details", { deliveryAddress: data.get("address"), contact: data.get("contact") }); }}><label>Confirm missing delivery address<input name="address" required maxLength={500} /></label><label>Contact<input name="contact" maxLength={100} /></label><button className="button secondary" disabled={busy !== null}>Save delivery details</button></form>}
        {order.handoffLocation && <div className="handoff-summary"><strong>{order.id}</strong><span>Code {order.pickupCode || "Pending"}</span><b>{order.handoffLocation}</b></div>}
        {order.completedAt && <p className="order-person">{order.fulfillment === "DELIVERY" ? "Delivered" : order.fulfillment === "DINE_IN" ? "Served" : "Collected"}: {time(order.completedAt)}</p>}
        {view === "CHEF" && order.status === "PLACED" && <p className="priority-reason">{currentRanking.ranking.find(row => row.orderId === order.id)?.reason}</p>}
        {order.status === "PACKAGING" && (view === "WAITER" || view === "MANAGER") && <button className="button secondary" onClick={() => { setPackingId(order.id); requestAnimationFrame(() => document.getElementById("waiter-packaging")?.scrollIntoView({ block: "start", behavior: "smooth" })); }}>Open packing check</button>}
        <div className="operation-actions">{actions.map(action => <button disabled={busy !== null} className={`button ${action === "finish_preparation" || action === "pickup" ? "lime" : "secondary"}`} key={action} onClick={() => void act(order, action)}>{busy === order.id ? "Saving…" : actionLabels[action]}</button>)}</div>
        {user!.role === "MANAGER" && view === "MANAGER" && <div className="manager-order-controls">
          {order.fulfillment === "DELIVERY" && !["COMPLETED", "CANCELLED"].includes(order.status) && <label>Assign driver<select aria-label={`Assign driver ${order.id}`} disabled={busy !== null} value={order.driverId ?? ""} onChange={event => void act(order, "assign_driver", { userId: event.target.value })}><option value="" disabled>Select a driver</option>{users.filter(account => account.role === "DRIVER").map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
          {!order.customerId && <label>Associate customer<select disabled={busy !== null} value="" onChange={event => void act(order, "associate_customer", { userId: event.target.value })}><option value="" disabled>Choose an account</option>{users.filter(account => account.role === "CUSTOMER").map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
          {!["COMPLETED", "CANCELLED"].includes(order.status) && <form onSubmit={event => { event.preventDefault(); const reason = new FormData(event.currentTarget).get("reason"); void act(order, "cancel", { reason }); }}><input name="reason" required maxLength={500} aria-label={`Cancellation reason ${order.id}`} placeholder="Cancellation reason" /><button className="button secondary" disabled={busy !== null}>Cancel order</button></form>}
        </div>}
        {view === "MANAGER" && order.history && <details className="order-history"><summary>Status history · {order.history.length} events</summary><ol>{order.history.map((entry, i) => <li key={i}><strong>{entry.previousStatus ? STATUS_LABELS[entry.previousStatus] : "Imported / placed"} → {STATUS_LABELS[entry.newStatus]}</strong><span>{entry.action.replaceAll("_", " ")} · {entry.actorName} · {time(entry.at)}</span>{entry.note && <p>{entry.note}</p>}</li>)}</ol></details>}
      </>}
    </article>;
  }
  function section(title: string, list: OperationalOrder[], customer = false) {
    return <section className="order-section"><div className="section-title"><h2>{title}</h2><span className="count-pill">{list.length}</span></div>{list.length ? <div className="operations-grid">{list.map(order => card(order, customer))}</div> : <div className="role-empty"><strong>No {title.toLowerCase()} here</strong><p>{SOURCE_LABELS[source]} appear in this section as they move through service.</p></div>}</section>;
  }

  if (sessionLoading) return <div className="auth-frame"><p role="status">Loading your workspace…</p></div>;
  if (!user) return <div className="auth-frame"><div className="auth-card"><div className="brand"><span className="brand-logo">✓</span><span>passcheck.</span></div><div className="eyebrow">RESTAURANT WORKSPACE</div><h1>Welcome to the pass.</h1><p>Sign in to see the orders and actions available to your account.</p><form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void run("login", async () => { const result = await api<{ user: User }>("/api/session", { method: "POST", body: JSON.stringify({ username: data.get("username"), password: data.get("password") }) }); rememberUser(result.user); }); }}><label>Username<input name="username" type="text" required autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="e.g. manager" /></label><label>Password<input name="password" type="password" required autoComplete="current-password" /></label><button className="button lime full" disabled={busy !== null}>{busy ? "Signing in…" : "Sign in"}</button></form>{error && <p role="alert" className="operation-error">{error}</p>}<p className="setup-hint">Shared demo accounts: manager, customer, waiter, chef, and driver. The password for each is <code>password</code>. Existing account emails also work.</p>
      {demo && <div className="demo-control"><strong>Development demo identity</strong><p>Development only. These simulated accounts do not grant production access.</p><select aria-label="Development demo identity" defaultValue="" disabled={busy !== null} onChange={event => void run("demo", async () => { const result = await api<{ user: User }>("/api/session/demo", { method: "POST", body: JSON.stringify({ userId: event.target.value }) }); rememberUser(result.user); })}><option value="" disabled>Choose a demo account</option>{["manager", "customer", "customer-other", "waiter", "chef", "driver", "driver-other"].map(value => <option key={value} value={`demo-${value}`}>{label(value.replaceAll("-", " "))}</option>)}</select></div>}
    </div></div>;

  return <div className="roles-app">
    {user.id.startsWith("fixed-") && <div className="fixed-account-banner">Shared demo account · {user.role.toLowerCase()} · public demo credentials</div>}
    <header className="roles-header"><a className="brand" href="/"><span className="brand-logo">✓</span><span>passcheck.</span></a><nav aria-label="Role views">{ROLES.map(role => <button key={role} disabled={!canViewRole(user, role)} aria-current={view === role ? "page" : undefined} className={view === role ? "active" : ""} onClick={() => { setView(role); setPackingId(null); setStatus(""); setFulfillment(""); setDate(""); }}>{label(role)}{!canViewRole(user, role) && <span aria-label="Unavailable"> · locked</span>}</button>)}</nav><div className="identity"><strong>{user.name}</strong><small>{label(user.role)}</small><button className="text-button" onClick={() => void run("logout", async () => { await api("/api/session", { method: "DELETE" }); rememberUser(null); })}>Sign out</button></div></header>
    {demo && <div className="demo-banner"><span>DEVELOPMENT DEMO · simulated identities</span><select aria-label="Development demo identity" value={user.id.startsWith("demo-") ? user.id : ""} disabled={busy !== null} onChange={event => { const id = event.target.value; void run("demo", async () => { const result = await api<{ user: User }>("/api/session/demo", { method: "POST", body: JSON.stringify({ userId: id }) }); rememberUser(result.user); }); }}><option value="" disabled>Choose demo account</option>{["manager", "customer", "customer-other", "waiter", "chef", "driver", "driver-other"].map(value => <option key={value} value={`demo-${value}`}>{label(value.replaceAll("-", " "))}</option>)}</select>{user.role === "MANAGER" && <button className="text-button" disabled={busy !== null} onClick={() => { if (confirm("Reset all development orders and checks?")) void run("reset", async () => { await api("/api/demo/reset", { method: "POST" }); await load(); setNotice("Development demo reset."); }); }}>Reset demo</button>}</div>}
    <main className="roles-main"><div className="page-heading"><div><div className="eyebrow">THE PASS, UNDER CONTROL</div><h1>{label(view)} view<span>.</span></h1><p>{descriptions[view]}</p></div><div className="role-refresh"><span>Updates every 4 seconds</span><button className="button secondary" disabled={loading || busy !== null} onClick={() => void load()}>{loading ? "Refreshing…" : "Refresh"}</button></div></div>
      {error && <p className="operation-error" role="alert">{error}</p>}{notice && <p className="operation-notice" role="status">{notice}</p>}
      {(view === "WAITER" || view === "CUSTOMER" || view === "MANAGER") && <OrderForm key={`${user.id}:${view}`} user={user} customerMode={view === "CUSTOMER"} users={users as User[]} onCreated={order => { receiveOrder(order); setSource(order.source); setNotice(`Order ${order.id} placed.`); void load(true); }} />}
      {view === "MANAGER" && <><div className="manager-stats">{[{ name: "Awaiting preparation", count: queued.length }, { name: "Being prepared", count: orders.filter(order => order.status === "PREPARING").length }, { name: "Packaging / serving", count: orders.filter(order => ["READY_TO_PACKAGE", "PACKAGING", "READY_TO_SERVE", "READY_FOR_PICKUP"].includes(order.status)).length }, { name: "Out for delivery", count: orders.filter(order => order.status === "OUT_FOR_DELIVERY").length }, { name: "Completed / cancelled", count: completed.length }].map(stat => <div key={stat.name}><span>{stat.name}</span><strong>{stat.count}</strong></div>)}</div>
        <fieldset disabled={busy !== null}><PriorityControls settings={settings} onChange={value => void run("settings", async () => { const saved = await api<{ settings: Settings }>("/api/settings", { method: "PUT", body: JSON.stringify(value) }); setSettings(saved.settings); })} /></fieldset>
        <div className="manager-tools"><button className="text-button" disabled={busy !== null} onClick={() => void run("import", async () => { const raw = localStorage.getItem("passcheck.demo.v1"); if (!raw) throw new Error("No browser demo is available to import"); const saved = JSON.parse(raw); const result = await api<{ imported: number }>("/api/orders/import", { method: "POST", body: JSON.stringify({ orders: saved.orders }) }); setNotice(`Imported ${result.imported} legacy orders. Ownership and history remain unknown until explicitly associated.`); await load(); })}>Import this browser’s previous demo orders</button><span>Imported orders keep known timestamps; historical prices and staff are marked unavailable.</span></div>
      </>}
      <div className="source-tabs" role="tablist" aria-label="Order source">{SOURCES.map(value => <button key={value} role="tab" aria-selected={source === value} onClick={() => setSource(value)}>{SOURCE_LABELS[value]}</button>)}</div>
      {view === "MANAGER" && <div className="order-filters"><label>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="">All stages</option>{STATUSES.map(value => <option value={value} key={value}>{STATUS_LABELS[value]}</option>)}</select></label><label>Fulfillment<select value={fulfillment} onChange={event => setFulfillment(event.target.value)}><option value="">All methods</option>{FULFILLMENTS.map(value => <option key={value} value={value}>{FULFILLMENT_LABELS[value]}</option>)}</select></label><label>Placed date (UTC)<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><button className="text-button" onClick={() => { setStatus(""); setFulfillment(""); setDate(""); }}>Clear filters</button></div>}
      {view === "CUSTOMER" && user.role === "MANAGER" && <label className="customer-preview">Customer preview<select value={customerId} onChange={event => setCustomerId(event.target.value)}><option value="">Choose a customer</option>{users.filter(account => account.role === "CUSTOMER").map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
      {loading ? <p className="role-loading" role="status">Loading orders…</p> : <>
        {view === "MANAGER" && section("All orders", orders)}
        {view === "CUSTOMER" && <>{section("Active orders", active, true)}{section("Completed orders", completed, true)}</>}
        {view === "CHEF" && <><div className="chef-priority"><span>{currentRanking.mode === "ai" ? "AI recommendation" : "Rules fallback active"} · oldest first by default</span><button className="button secondary" disabled={busy !== null || !queued.length} onClick={() => void run("priority", async () => { const version = ++priorityVersion.current; const data = await api<PriorityResponse>("/api/prioritize", { method: "POST", body: JSON.stringify(makePriorityRequest(queued.map(toPackingOrder), settings, version)) }); if (version === priorityVersion.current) setRanking(data); })}>Reprioritize</button></div>{section("Ready to prepare", ranking?.requestVersion === priorityVersion.current ? [...queued].sort((a, b) => currentRanking.ranking.findIndex(row => row.orderId === a.id) - currentRanking.ranking.findIndex(row => row.orderId === b.id)) : queued)}{section("Currently preparing", orders.filter(order => order.status === "PREPARING"))}</>}
        {view === "WAITER" && <>{section("Ready to Package", orders.filter(order => order.status === "READY_TO_PACKAGE" || order.status === "PACKAGING"))}{section("Ready to serve / customer pickup", orders.filter(order => order.status === "READY_TO_SERVE" || order.status === "READY_FOR_PICKUP"))}{section("Active Orders", orders.filter(order => ["PLACED", "PREPARING", "OUT_FOR_DELIVERY"].includes(order.status)))}{section("Completed Orders", completed)}</>}
        {view === "DRIVER" && <>{section("Delivery progress", active.filter(order => order.fulfillment === "DELIVERY"))}{section("Completed deliveries", completed.filter(order => order.fulfillment === "DELIVERY"))}</>}
      </>}
      {(view === "WAITER" || view === "MANAGER") && selectedPacking && <section id="waiter-packaging" className="waiter-packing" aria-label="Waiter packaging"><div className="section-title"><h2>Waiter packaging · {selectedPacking.id}</h2><select aria-label="Choose order to package" value={selectedPacking.id} onChange={event => setPackingId(event.target.value)}>{packingOrders.map(order => <option key={order.id} value={order.id}>{order.id}</option>)}</select></div><p className="order-notes">{selectedPacking.notes || "No preparation notes."}</p>{selectedPacking.items.map(item => item.notes || item.options.length ? <p key={item.menuItemId} className="order-notes">{item.name}: {item.options.join(", ")} {item.notes}</p> : null)}<ServerPackingPanel key={`${user.id}:${selectedPacking.id}`} order={selectedPacking} onOrder={receiveOrder} /></section>}
      <footer className="page-footer"><span>PASSCHECK · One record, clear handoffs.</span><span>Server-persisted orders · {SOURCE_LABELS[source]}</span></footer>
    </main>
  </div>;
}
