"use client";

import { useState } from "react";
import { hasCompletedCheck, type Order, type Verification } from "@/lib/contracts";

// Temporary manual-only component. Person 3 may replace this file while retaining these callbacks.
// Call onScanStarted BEFORE dispatching a result; every changed photo/check needs a new scanId.
export type PackingPanelProps = {
  order: Order;
  onScanStarted: (scanId: string) => void;
  onVerificationUpdate: (verification: Verification) => void;
  onPackingConfirmed: (confirmed: boolean) => void;
};

export function PackingPanel({ order, onScanStarted, onVerificationUpdate, onPackingConfirmed }: PackingPanelProps) {
  const [checked, setChecked] = useState<string[]>([]);
  const [scanId, setScanId] = useState<string | null>(null);
  const completed = hasCompletedCheck(order);
  function toggle(id: string, isChecked: boolean) {
    const nextScan = crypto.randomUUID();
    onScanStarted(nextScan);
    setScanId(nextScan);
    setChecked(current => isChecked ? [...current.filter(value => value !== id), id] : current.filter(value => value !== id));
  }
  function completeManual() {
    if (!scanId || checked.length !== order.items.length) return;
    onVerificationUpdate({
      orderId: order.id, scanId, result: "manual_checked", checkedAt: new Date().toISOString(),
      observed: order.items.map(({ menuItemId, quantity }) => ({ menuItemId, quantity })),
      missing: [], extra: [], unknownItems: [], uncertainties: [],
    });
  }
  function recheck() {
    const nextScan = crypto.randomUUID();
    onScanStarted(nextScan); setScanId(nextScan); setChecked([]);
  }
  return <div className="packing-panel">
    <div className="notice"><span className="notice-icon">i</span><div><strong>Manual packing check</strong><p>Photo verification is unavailable. Inspect every item before sealing and complete this staff check.</p></div></div>
    <div className="checklist">
      {order.items.map(item => <label className={`check-row ${completed || checked.includes(item.menuItemId) ? "is-checked" : ""}`} key={item.menuItemId}>
        <input type="checkbox" checked={completed || checked.includes(item.menuItemId)} onChange={event => toggle(item.menuItemId, event.target.checked)} />
        <span><strong>{item.quantity} × {item.name}</strong><small>Count and inspect visible items</small></span>
        <span className="check-tick" aria-hidden="true">✓</span>
      </label>)}
    </div>
    <p className="check-caption">Confirm the counts above and remove any extra items before completing the check.</p>
    {completed ? <div className="check-success"><span>✓ {order.verification?.result === "manual_checked" ? "Manual check completed" : "Visible counts match"}</span><button className="text-button" onClick={recheck}>Recheck</button></div> : <button className="button secondary full" disabled={checked.length !== order.items.length || !scanId} onClick={completeManual}>Complete manual check</button>}
    <label className="seal-check"><input type="checkbox" disabled={!completed} checked={Boolean(order.packingConfirmedAt)} onChange={e => onPackingConfirmed(e.target.checked)} /><span>I packed the checked items and sealed the package.</span></label>
    <p className="fine-print">A visible-item check cannot see inside opaque containers or prove what entered a sealed bag.</p>
  </div>;
}
