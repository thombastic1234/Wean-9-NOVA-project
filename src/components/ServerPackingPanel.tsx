"use client";
import { useRef, useState } from "react";
import { PackingPanel } from "./PackingPanel";
import { toPackingOrder, type OperationalOrder, type Operation } from "@/lib/operations";
import { checkPackingPhoto } from "@/lib/packingClient";
import { api } from "@/lib/apiClient";

export function ServerPackingPanel({ order, onOrder }: { order: OperationalOrder; onOrder: (order: OperationalOrder) => void }) {
  const current = useRef(order); if (order.revision >= current.current.revision) current.current = order;
  const queue = useRef<Promise<void>>(Promise.resolve()); const failed = useRef(false);
  const [pending, setPending] = useState(0); const [error, setError] = useState("");
  function enqueue(action: Operation, payload: object = {}) {
    setPending(count => count + 1);
    const task = queue.current.then(async () => {
      const response = await api<{ order: OperationalOrder }>(`/api/orders/${order.id}`, { method: "PATCH", body: JSON.stringify({ action, revision: current.current.revision, requestId: crypto.randomUUID(), ...payload }) });
      current.current = response.order; onOrder(response.order); setError(""); failed.current = false;
    });
    queue.current = task.catch(async err => {
      failed.current = true; setError(err instanceof Error ? err.message : "Could not save packing check");
      try { const result = await api<{ order: OperationalOrder }>(`/api/orders/${order.id}`); current.current = result.order; onOrder(result.order); } catch {}
    }).finally(() => setPending(count => count - 1));
  }
  return <div className="server-packing">
    {error && <p role="alert" className="operation-error">{error}</p>}
    {pending > 0 && <p role="status" className="saving-check">Saving packing changes…</p>}
    <PackingPanel order={toPackingOrder(order)} onScanStarted={scanId => enqueue("scan_started", { scanId })}
      onVerificationUpdate={verification => {
        if (verification.result === "manual_checked" || verification.result === "review_needed") enqueue("verification", { verification });
      }} onPackingConfirmed={confirmed => enqueue("confirm_packing", { confirmed })}
      checkPhoto={async (request, signal) => {
        await queue.current;
        if (failed.current) throw new Error("The current scan could not be saved. Start a fresh check.");
        const result = await checkPackingPhoto(request, signal);
        const saved = await api<{ order: OperationalOrder }>(`/api/orders/${order.id}`);
        if (saved.order.revision >= current.current.revision) { current.current = saved.order; onOrder(saved.order); }
        return result;
      }} />
    <fieldset disabled={pending > 0}><div className="location-field"><label htmlFor={`location-${order.id}`}>Handoff location</label><select id={`location-${order.id}`} value={order.handoffLocation ?? ""} onChange={event => enqueue("location", { location: event.target.value })}><option value="" disabled>Select a location</option><option>Shelf A1</option><option>Shelf A2</option></select></div>
      <button className="button lime full" disabled={pending > 0 || !order.packingConfirmedAt || !order.handoffLocation} onClick={() => enqueue("finish_packaging")}>{order.fulfillment === "DELIVERY" ? "Ready for driver pickup" : "Ready for customer pickup"}</button>
    </fieldset>
  </div>;
}
