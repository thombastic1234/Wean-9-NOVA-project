"use client";

import { useEffect, useRef, useState } from "react";
import { CATALOG } from "@/lib/catalog";
import { hasCompletedCheck, type Order, type Verification } from "@/lib/contracts";
import { checkPackingPhoto, preparePackingPhoto } from "@/lib/packingClient";

export type PackingPanelProps = {
  order: Order;
  onScanStarted: (scanId: string) => void;
  onVerificationUpdate: (verification: Verification) => void;
  onPackingConfirmed: (confirmed: boolean) => void;
  checkPhoto?: typeof checkPackingPhoto;
};

// Reset transient evidence even when a caller does not key the selected order.
export function PackingPanel(props: PackingPanelProps) {
  return <PackingSession key={`${props.order.id}:${JSON.stringify(props.order.items)}`} {...props} />;
}

function PackingSession({ order, onScanStarted, onVerificationUpdate, onPackingConfirmed, checkPhoto }: PackingPanelProps) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [noExtras, setNoExtras] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const completed = hasCompletedCheck(order);
  const verification = order.verification;
  const manualCompleted = completed && verification?.result === "manual_checked";

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; controller.current?.abort(); };
  }, []);

  function beginCheck() {
    controller.current?.abort();
    controller.current = null;
    busy.current = false;
    const token = ++generation.current;
    const scanId = crypto.randomUUID();
    onScanStarted(scanId);
    setLoading(false);
    setPreparing(false);
    return { token, scanId };
  }
  function isCurrent(token: number) { return mounted.current && generation.current === token; }
  function resetManual() { setChecked([]); setNoExtras(false); }
  function review(scanId: string, reason: string) {
    onVerificationUpdate({ orderId: order.id, scanId, result: "review_needed", observed: [], missing: [], extra: [], unknownItems: [], uncertainties: [reason], checkedAt: new Date().toISOString() });
  }
  async function selectPhoto(file: File) {
    const { token, scanId } = beginCheck();
    setPhoto(null);
    resetManual();
    setPreparing(true);
    busy.current = true;
    try {
      const image = await preparePackingPhoto(file);
      if (isCurrent(token)) setPhoto(image);
    } catch (error) {
      if (isCurrent(token)) review(scanId, error instanceof Error ? error.message : "Could not open this photo. Try another photo or check manually.");
    } finally {
      if (isCurrent(token)) { setPreparing(false); busy.current = false; }
    }
  }
  async function scanPhoto() {
    if (!photo || busy.current) return;
    const { token, scanId } = beginCheck();
    const request = { orderId: order.id, scanId, imageDataUrl: photo, expectedItems: order.items.map(item => ({ ...item })) };
    resetManual();
    const abort = new AbortController();
    controller.current = abort;
    busy.current = true;
    setLoading(true);
    const timer = setTimeout(() => abort.abort(), 15_000);
    try {
      const result = await (checkPhoto ?? checkPackingPhoto)(request, abort.signal);
      if (isCurrent(token)) onVerificationUpdate({ ...result, checkedAt: new Date().toISOString() });
    } catch (error) {
      if (isCurrent(token)) review(scanId, abort.signal.aborted ? "Photo check timed out. Retry or complete the manual checklist." : error instanceof Error ? error.message : "Photo check failed. Retry or check manually.");
    } finally {
      clearTimeout(timer);
      if (isCurrent(token)) { controller.current = null; busy.current = false; setLoading(false); }
    }
  }
  function changeManual(id: string, value: boolean) {
    beginCheck();
    setChecked(current => {
      const previous = manualCompleted ? order.items.map(item => item.menuItemId) : current;
      return value ? [...new Set([...previous, id])] : previous.filter(item => item !== id);
    });
    if (manualCompleted) setNoExtras(true);
  }
  function completeManual() {
    if (busy.current || checked.length !== order.items.length || !noExtras) return;
    const { scanId } = beginCheck();
    onVerificationUpdate({ orderId: order.id, scanId, result: "manual_checked", checkedAt: new Date().toISOString(), observed: order.items.map(({ menuItemId, quantity }) => ({ menuItemId, quantity })), missing: [], extra: [], unknownItems: [], uncertainties: [] });
  }
  function recheck() { beginCheck(); resetManual(); }
  const countList = (items: Verification["observed"]) => items.filter(item => item.quantity > 0).map(item => `${CATALOG[item.menuItemId].name} ×${item.quantity}`).join(", ") || "None";

  return <div className="packing-panel">
    <div className="notice"><span className="notice-icon">i</span><div><strong>Check before sealing · {order.id}</strong><p>Lay out all items separately in good light. Keep items visible. Check before sealing.</p></div></div>
    <div className="packing-expected"><strong>Expected items</strong><p>{order.items.map(item => `${item.name} ×${item.quantity}`).join(", ")}</p></div>
    <label className="photo-upload"><span>Upload packing photo</span><input type="file" accept="image/jpeg,image/png" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void selectPhoto(file); }} /><small>JPEG or PNG · up to 20 MB · resized to 1024 px</small></label>
    <div className="packing-evidence">
      {photo && <figure className="packing-photo"><img src={photo} alt={`Visible items laid out for order ${order.id}`} /><figcaption>Current photo · inspect alongside the check</figcaption></figure>}
      <div className="packing-results">
        {preparing && <p role="status" className="packing-pending">Preparing photo…</p>}
        {loading ? <p role="status" className="packing-pending">Checking photo…</p> : verification && <div role="status" className={`verification-result ${verification.result}`}>
          <strong>{verification.result === "match" ? "Visible counts match" : verification.result === "manual_checked" ? "Manually checked" : verification.result === "mismatch" ? "Items need correction" : "Review needed"}</strong>
          {verification.result === "manual_checked" ? <p>Staff confirmed the quantities and no extra items. This is a manual check.</p> : <>
            <p><b>Observed:</b> {countList(verification.observed)}</p>
            <p><b>Missing:</b> {countList(verification.missing)}</p>
            <p><b>Extra:</b> {countList(verification.extra)}</p>
            {verification.unknownItems.length > 0 && <p><b>Unknown:</b> {verification.unknownItems.join(", ")}</p>}
            {verification.uncertainties.map((reason, index) => <p key={index}>{reason}</p>)}
            {verification.result !== "match" && <p>Correct the arrangement and recheck, or inspect every item manually.</p>}
          </>}
          {!photo && verification.result !== "manual_checked" && <p>The photo is no longer in this view. Upload a fresh photo to recheck.</p>}
        </div>}
      </div>
    </div>
    <div className="packing-photo-actions">
      <button className="button secondary" disabled={!photo || loading || preparing} onClick={() => void scanPhoto()}>{verification ? "Recheck photo" : "Check photo"}</button>
      {(photo || verification) && <button className="text-button" onClick={() => { recheck(); setPhoto(null); }}>Clear photo and check</button>}
    </div>
    <fieldset className="packing-manual" disabled={loading || preparing}>
      <legend>Manual checklist</legend>
      <p className="check-caption">No vision result needed. Count every expected item and confirm there are no extras.</p>
      <div className="checklist">
        {order.items.map(item => <label className={`check-row ${manualCompleted || checked.includes(item.menuItemId) ? "is-checked" : ""}`} key={item.menuItemId}>
          <input type="checkbox" checked={manualCompleted || checked.includes(item.menuItemId)} onChange={event => changeManual(item.menuItemId, event.target.checked)} />
          <span><strong>{item.quantity} × {item.name}</strong><small>I counted exactly {item.quantity} visible {item.name.toLowerCase()}{item.quantity !== 1 ? " items" : " item"}</small></span>
          <span className="check-tick" aria-hidden="true">✓</span>
        </label>)}
        <label className={`check-row ${manualCompleted || noExtras ? "is-checked" : ""}`}><input type="checkbox" checked={manualCompleted || noExtras} onChange={event => { beginCheck(); if (manualCompleted) setChecked(order.items.map(item => item.menuItemId)); setNoExtras(event.target.checked); }} /><span><strong>No extra items are present</strong><small>I inspected the entire arrangement</small></span><span className="check-tick" aria-hidden="true">✓</span></label>
      </div>
      {manualCompleted ? <button className="text-button manual-recheck" onClick={recheck}>Recheck manually</button> : <button className="button secondary full" disabled={checked.length !== order.items.length || !noExtras} onClick={completeManual}>Complete manual check</button>}
    </fieldset>
    <label className="seal-check"><input type="checkbox" disabled={!completed || loading || preparing} checked={Boolean(order.packingConfirmedAt)} onChange={event => onPackingConfirmed(event.target.checked)} /><span>I packed the checked items.</span></label>
    <p className="fine-print">Check labeled containers explicitly as labels. A visible-item check cannot see inside opaque containers or prove what entered a sealed bag. Photos stay in this view and are sent to the vision service only when you click Check photo.</p>
  </div>;
}
