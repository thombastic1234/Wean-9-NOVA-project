"use client";
import { useRef, useState } from "react";
import { CATALOG, MENU_IDS } from "@/lib/catalog";
import { FULFILLMENTS, FULFILLMENT_LABELS, MENU_PRICES, formatMoney, type User, type OperationalOrder } from "@/lib/operations";
import { api } from "@/lib/apiClient";

export function OrderForm({ user, customerMode, users, onCreated }: { user: User; customerMode: boolean; users: User[]; onCreated: (order: OperationalOrder) => void }) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [fulfillment, setFulfillment] = useState<typeof FULFILLMENTS[number]>(customerMode ? "TAKEAWAY" : "DINE_IN");
  const [source, setSource] = useState<"IN_PERSON" | "ONLINE">(customerMode ? "ONLINE" : "IN_PERSON");
  const [customerId, setCustomerId] = useState("");
  const [busy, setBusy] = useState(false); const guard = useRef(false);
  const [error, setError] = useState(""); const requestId = useRef<string | null>(null);
  const total = MENU_IDS.reduce((sum, id) => sum + (quantities[id] ?? 0) * MENU_PRICES[id], 0);
  return <details className="create-order" open={customerMode || undefined}><summary>{customerMode ? "Place an order" : "Create Order"}<span>Choose items, review, and submit ↗</span></summary>
    <form onChange={() => { requestId.current = null; }} onSubmit={async event => {
      event.preventDefault(); if (guard.current) return; guard.current = true; setBusy(true); setError("");
      const form = new FormData(event.currentTarget);
      requestId.current ??= crypto.randomUUID();
      try {
        const result = await api<{ order: OperationalOrder }>("/api/orders", { method: "POST", body: JSON.stringify({ requestId: requestId.current, order: {
          source: user.role === "CUSTOMER" ? "ONLINE" : source, fulfillment,
          customerId: user.role === "CUSTOMER" ? user.id : customerId || null,
          customerName: form.get("customerName") || (user.role === "CUSTOMER" ? user.name : "Guest"), tableNumber: form.get("tableNumber") || "", deliveryAddress: form.get("deliveryAddress") || "", contact: form.get("contact") || "", notes: form.get("notes") || "",
          items: MENU_IDS.filter(id => (quantities[id] ?? 0) > 0).map(id => ({ menuItemId: id, quantity: quantities[id], options: String(form.get(`options-${id}`) ?? "").split(",").map(value => value.trim()).filter(Boolean), notes: form.get(`notes-${id}`) || "" })),
        } }) });
        onCreated(result.order); setQuantities({}); requestId.current = null;
      } catch (err) { setError(err instanceof Error ? err.message : "Could not place order"); }
      finally { guard.current = false; setBusy(false); }
    }}><fieldset disabled={busy}>
      <div className="order-menu">{MENU_IDS.map(id => <div className="menu-entry" key={id}><div className="menu-entry-title"><span className={`food-mark ${id}`}>{CATALOG[id].symbol}</span><strong>{CATALOG[id].name}</strong><span>{formatMoney(MENU_PRICES[id])}</span><input aria-label={`${CATALOG[id].name} quantity`} type="number" min="0" max="30" value={quantities[id] ?? 0} onChange={event => setQuantities({ ...quantities, [id]: Number(event.target.value) })} /></div>{Boolean(quantities[id]) && <div className="menu-options"><input name={`options-${id}`} aria-label={`${CATALOG[id].name} options`} placeholder="Options, comma separated" maxLength={300} /><input name={`notes-${id}`} aria-label={`${CATALOG[id].name} preparation notes`} placeholder="Preparation notes" maxLength={300} /></div>}</div>)}</div>
      <div className="form-grid"><label>Fulfillment<select value={fulfillment} onChange={event => setFulfillment(event.target.value as typeof fulfillment)}>{FULFILLMENTS.map(value => <option key={value} value={value}>{FULFILLMENT_LABELS[value]}</option>)}</select></label>
        {user.role === "MANAGER" && <label>Order source<select value={source} onChange={event => setSource(event.target.value as typeof source)}><option value="IN_PERSON">In person</option><option value="ONLINE">Online</option></select></label>}
        {user.role !== "CUSTOMER" && <><label>Customer account<select value={customerId} onChange={event => setCustomerId(event.target.value)}><option value="">Guest (no account access)</option>{users.filter(account => account.role === "CUSTOMER").map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>Guest name<input name="customerName" maxLength={100} placeholder="Guest name" /></label></>}
        {fulfillment === "DINE_IN" && <label>Table number<input required name="tableNumber" maxLength={30} placeholder="e.g. 03" /></label>}
        {fulfillment === "DELIVERY" && <><label>Delivery address<input required name="deliveryAddress" maxLength={500} /></label><label>Delivery contact<input name="contact" maxLength={100} /></label></>}
        <label className="span-all">Order / preparation notes<textarea name="notes" rows={2} maxLength={1000} placeholder="Allergies, preparation requests, or delivery instructions" /></label>
      </div><div className="form-review"><span>{customerMode ? "Online order" : user.role === "WAITER" ? "In-person order" : source === "IN_PERSON" ? "In-person order" : "Online order"} · {FULFILLMENT_LABELS[fulfillment]} · <strong>{formatMoney(total)}</strong></span><button className="button lime" disabled={busy || total === 0}>{busy ? "Submitting…" : "Review complete · Submit order"}</button></div>
    </fieldset>{error && <p role="alert" className="operation-error">{error}</p>}</form>
  </details>;
}
