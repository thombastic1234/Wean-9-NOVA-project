"use client";

import { useEffect, useState } from "react";
import { CATALOG } from "@/lib/catalog";
import { canMarkReady, LOCATIONS, type Order } from "@/lib/contracts";
import { makeOrder } from "@/lib/fixtures";
import { usePriority } from "@/lib/usePriority";
import { useOrders } from "./OrderProvider";
import { PackingPanel } from "./PackingPanel";
import { PriorityControls } from "./PriorityControls";

function Icon({ name, size = 20 }: { name: "grid" | "arrow" | "clock" | "bag" | "check" | "reset" | "plus" | "flame"; size?: number }) {
  const paths = {
    grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    arrow: "M4 12h15 M13 6l6 6-6 6",
    clock: "M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    bag: "M5 7h14l1 14H4L5 7z M9 7V5a3 3 0 0 1 6 0v2",
    check: "M5 12l4 4L19 6",
    reset: "M3 10a9 9 0 1 1 1 8 M3 3v7h7",
    plus: "M12 5v14 M5 12h14",
    flame: "M12 2c2 6 7 7 7 13a7 7 0 0 1-14 0c0-3 2-5 4-7 0 4 2 5 3 5s3-3 0-11z",
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function SourceTag({ order }: { order: Order }) {
  return <span className={`source-tag ${order.source}`}>{order.source === "online" ? "Online" : "Waiter"}<span>·</span>{order.fulfillment === "delivery" ? "Delivery" : `Table ${order.tableNumber}`}</span>;
}
function Items({ order }: { order: Order }) {
  return <ul className="item-list">{order.items.map(item => <li key={item.menuItemId}><span className={`food-mark ${item.menuItemId}`} aria-hidden="true">{CATALOG[item.menuItemId].symbol}</span><span>{item.name}</span><strong>×{item.quantity}</strong></li>)}</ul>;
}
function Empty({ text, detail }: { text: string; detail: string }) {
  return <div className="empty-state"><span><Icon name="check" size={24} /></span><strong>{text}</strong><p>{detail}</p></div>;
}

export function KitchenBoard() {
  const { state, dispatch, storageNotice } = useOrders();
  const [now, setNow] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  usePriority();
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const queued = state.orders.filter(order => order.status === "queued");
  const ranking = state.ranking?.ranking ?? [];
  const sortedQueue = [...queued].sort((a, b) => {
    const aRank = ranking.findIndex(row => row.orderId === a.id);
    const bRank = ranking.findIndex(row => row.orderId === b.id);
    return (aRank < 0 ? Infinity : aRank) - (bRank < 0 ? Infinity : bRank);
  });
  const cooking = state.orders.filter(order => order.status === "cooking");
  const packing = state.orders.filter(order => order.status === "packing");
  const ready = state.orders.filter(order => order.status === "ready");
  const collected = state.orders.filter(order => order.status === "collected").length;
  const selected = packing.find(order => order.id === selectedId) ?? packing[0];
  const at = () => new Date().toISOString();
  const minutes = (date: string) => Math.max(0, Math.floor(((now || Date.now()) - Date.parse(date)) / 60_000));
  function addOrder(source: Order["source"]) {
    const sourceIds = state.orders.filter(order => order.source === source).map(order => Number(order.sourceOrderId)).filter(Number.isFinite);
    const sourceOrderId = String(Math.max(1040, ...sourceIds) + 1);
    dispatch({ type: "ingest", order: makeOrder(source, sourceOrderId) });
  }

  return <div className="app-frame">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="PassCheck home"><span className="brand-logo"><Icon name="check" size={23} /></span><span>passcheck<span className="brand-dot">.</span></span></a>
      <div className="restaurant"><span className="restaurant-avatar">GK</span><div><strong>Greenhouse Kitchen</strong><small>Demo restaurant <span>⌄</span></small></div></div>
      <span className="nav-label">WORKSPACE</span>
      <a className="nav-link active" href="#kitchen"><Icon name="grid" /><span>Kitchen board</span><span className="nav-count">{queued.length + cooking.length + packing.length}</span></a>
      <a className="nav-link" href="#pickup"><Icon name="bag" /><span>Pickup board</span><span className="nav-count muted">{ready.length}</span></a>
      <div className="sidebar-note"><span className="live-dot" /><strong>One queue. Every order.</strong><p>From the first ticket to the final handoff.</p><div className="small-flow">Queue <span>→</span> Check <span>→</span> Collect</div></div>
      <div className="sidebar-footer"><span className="staff-avatar">S</span><div><strong>Service team</strong><small>Single-tab demo</small></div><span className="online-dot" /></div>
    </aside>

    <main id="kitchen">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span><strong>Kitchen board</strong></div><div className="demo-badge"><span /> DEMO MODE</div></header>
      <div className="page-content">
        <div className="page-heading"><div><div className="eyebrow">THE PASS, UNDER CONTROL</div><h1>Kitchen board<span>.</span></h1><p>Keep orders moving. Check every handoff.</p></div><div className="heading-meta"><span className="live-indicator"><span /> Service in progress</span><button className="text-button reset-button" onClick={() => setResetOpen(true)}><Icon name="reset" size={14} />Reset demo</button></div></div>
        {resetOpen && <div role="alert" className="reset-confirm"><div><strong>Reset this demo?</strong><p>This clears all orders, checks, locations, and preferences and loads six fresh tickets.</p></div><button className="button secondary" onClick={() => setResetOpen(false)}>Keep working</button><button className="button dark" onClick={() => { dispatch({ type: "reset", now: Date.now() }); setSelectedId(null); setResetOpen(false); }}>Reset demo now</button></div>}
        {storageNotice && <div role="status" className="storage-notice">{storageNotice}</div>}
        <section className="stats-strip" aria-label="Service overview">
          {[{ label: "In queue", value: queued.length, icon: "clock", className: "" }, { label: "Cooking", value: cooking.length, icon: "flame", className: "amber" }, { label: "Packing check", value: packing.length, icon: "bag", className: "purple" }, { label: "Ready for pickup", value: ready.length, icon: "check", className: "green" }].map(stat => <div className="stat" key={stat.label}><span className={`stat-icon ${stat.className}`}><Icon name={stat.icon as "clock"} /></span><div><span>{stat.label}</span><strong>{String(stat.value).padStart(2, "0")}</strong></div></div>)}
          <div className="collected-stat"><strong>{collected}</strong><span>collected this session</span></div>
        </section>
        <div className="source-toolbar"><div><span className="source-label">SIMULATE AN ORDER</span><span className="toolbar-description">Two sources. One kitchen.</span></div><div className="source-actions"><button className="button secondary" disabled={!state.hydrated} onClick={() => addOrder("waiter")}><Icon name="plus" size={16} />Waiter order</button><button className="button dark" disabled={!state.hydrated} onClick={() => addOrder("online")}><Icon name="plus" size={16} />Online order</button></div></div>
        <PriorityControls settings={state.settings} onChange={settings => dispatch({ type: "settings", settings })} />
        {!state.hydrated ? <div className="loading-state" role="status">Restoring your kitchen…</div> : <>
          <div className="workflow-grid">
            <section className="workflow-column queue-column" aria-labelledby="queue-heading">
              <div className="column-heading"><div><span className="stage-dot queue-dot" /><h2 id="queue-heading">Queued</h2><span className="count-pill">{queued.length}</span></div><span className="stage-number">01</span></div>
              <div className="column-caption"><span className={`mode-pill ${state.ranking?.mode === "ai" ? "ai" : ""}`}>{state.ranking?.mode === "ai" ? "AI PRIORITY" : "DEMO ARRIVAL ORDER"}</span><span>Next up first</span></div>
              <div className="ticket-stack">{sortedQueue.map((order, i) => <article className={`ticket ${i === 0 ? "next-ticket" : ""}`} key={order.id}>
                {i === 0 && <div className="next-label"><span>↗</span> NEXT UP <span>{state.ranking?.mode === "ai" ? "Recommended" : "Arrival order"}</span></div>}
                <div className="ticket-body"><div className="ticket-top"><h3>{order.id}</h3><span className="age"><Icon name="clock" size={12} />{minutes(order.createdAt)}m</span></div><SourceTag order={order} /><Items order={order} />
                  <div className="ticket-details"><span>{order.estimatedPrepMinutes} min prep</span><span>{Date.parse(order.targetReadyAt) < (now || Date.now()) ? "Target overdue" : `Due in ${Math.max(0, Math.ceil((Date.parse(order.targetReadyAt) - (now || Date.now())) / 60_000))}m`}</span></div>
                  {order.courierArrivedAt ? <div className="courier-wait"><span />Courier waiting · {minutes(order.courierArrivedAt)}m</div> : order.fulfillment === "delivery" && <button className="text-button courier-button" onClick={() => dispatch({ type: "courier", orderId: order.id, at: at() })}>Simulate courier arrival</button>}
                  <p className="priority-reason">{ranking.find(row => row.orderId === order.id)?.reason ?? "Waiting for queue recommendation…"}</p>
                  <button className={`button full ${i === 0 ? "lime" : "secondary"}`} onClick={() => dispatch({ type: "start", orderId: order.id, at: at() })}>Start cooking<Icon name="arrow" size={16} /></button>
                </div>
              </article>)}</div>
              {!queued.length && <Empty text="Queue is clear" detail="Add a waiter or online order to get started." />}
            </section>

            <section className="workflow-column cooking-column" aria-labelledby="cooking-heading">
              <div className="column-heading"><div><span className="stage-dot cooking-dot" /><h2 id="cooking-heading">Cooking</h2><span className="count-pill">{cooking.length}</span></div><span className="stage-number">02</span></div>
              <div className="column-caption"><span>On the line</span><Icon name="flame" size={14} /></div>
              <div className="ticket-stack">{cooking.map(order => <article className="ticket cooking-ticket" key={order.id}><div className="ticket-body"><div className="ticket-top"><h3>{order.id}</h3><span className="cooking-timer"><Icon name="flame" size={13} />{order.startedAt ? minutes(order.startedAt) : 0}m</span></div><SourceTag order={order} /><Items order={order} /><div className="cooking-status"><span className="pulse-dot" />Cooking in progress<span>~{order.estimatedPrepMinutes}m</span></div><button className="button secondary full" onClick={() => { dispatch({ type: "finish", orderId: order.id, at: at() }); setSelectedId(order.id); }}>Finish cooking<Icon name="arrow" size={16} /></button></div></article>)}</div>
              {!cooking.length && <Empty text="Ready for the next ticket" detail="Start an order from the queue. It will appear here." />}
              <div className="workflow-tip"><Icon name="arrow" size={16} /><p>Finished cooking?<br /><strong>Every order goes through packing.</strong></p></div>
            </section>

            <section className="workflow-column packing-column" aria-labelledby="packing-heading">
              <div className="column-heading"><div><span className="stage-dot packing-dot" /><h2 id="packing-heading">Packing check</h2><span className="count-pill">{packing.length}</span></div><span className="stage-number">03</span></div>
              <div className="column-caption"><span>A final check before the handoff</span><Icon name="bag" size={14} /></div>
              {packing.length > 1 && <div className="packing-tabs" aria-label="Choose order to pack">{packing.map(order => <button aria-pressed={selected?.id === order.id} className={selected?.id === order.id ? "selected" : ""} key={order.id} onClick={() => setSelectedId(order.id)}>{order.id}</button>)}</div>}
              {selected ? <div className="ticket packing-ticket"><div className="ticket-body"><div className="ticket-top"><h3>{selected.id}</h3><span className="packing-label">TO CHECK</span></div><SourceTag order={selected} />
                <PackingPanel key={`${state.resetToken}:${selected.id}`} order={selected}
                  onScanStarted={scanId => dispatch({ type: "scan_started", orderId: selected.id, scanId })}
                  onVerificationUpdate={verification => dispatch({ type: "verification", orderId: selected.id, verification })}
                  onPackingConfirmed={confirmed => dispatch({ type: "confirm_packing", orderId: selected.id, confirmed, at: at() })} />
                <div className="location-field"><label htmlFor={`location-${selected.id}`}>Handoff location <span>Required</span></label><select id={`location-${selected.id}`} value={selected.handoffLocation ?? ""} onChange={event => dispatch({ type: "location", orderId: selected.id, location: event.target.value })}><option value="" disabled>Select a {selected.fulfillment === "delivery" ? "shelf" : "pass"}</option>{LOCATIONS[selected.fulfillment].map(location => <option key={location}>{location}</option>)}</select>{selected.tableNumber && <small>Destination: Table {selected.tableNumber} · location is the kitchen pass.</small>}</div>
                <button className="button lime full" disabled={!canMarkReady(selected)} onClick={() => dispatch({ type: "ready", orderId: selected.id, at: at() })}>Mark ready for pickup<Icon name="check" size={17} /></button>
                {!canMarkReady(selected) && <p className="ready-help">Complete the check, confirm packing, and choose a location.</p>}
              </div></div> : <Empty text="A little care goes a long way" detail="Cooked orders arrive here for a packing check before pickup." />}
            </section>
          </div>

          <section className="pickup-section" id="pickup" aria-labelledby="pickup-heading"><div className="pickup-header"><div><span className="pickup-symbol"><Icon name="check" size={19} /></span><div><h2 id="pickup-heading">Ready for pickup <span className="count-pill">{ready.length}</span></h2><p>Checked, packed, and in the right place.</p></div></div><span className="pickup-note">Order + code + location. Every handoff.</span></div>
            {ready.length ? <div className="pickup-grid">{ready.map(order => <article className="pickup-card" key={order.id}><div className="ticket-top"><h3>{order.id}</h3><span className="ready-label">READY</span></div><SourceTag order={order} /><div className="pickup-identifiers"><div><small>PICKUP CODE</small><strong>{order.pickupCode}</strong></div><div><small>LOCATION</small><strong>{order.handoffLocation}</strong></div></div><button className="button secondary full" onClick={() => dispatch({ type: "collect", orderId: order.id, at: at() })}>Mark collected<Icon name="check" size={16} /></button></article>)}</div> : <div className="pickup-empty"><Icon name="bag" size={22} /><span>No orders waiting for pickup. Completed packing checks land here.</span></div>}
          </section>
        </>}
        <footer className="page-footer"><span>PASSCHECK <span>·</span> A smoother service, one order at a time.</span><span>Mock sources · {state.ranking?.mode === "ai" ? "AI prioritization" : "Demo prioritization"} · Manual packing</span></footer>
      </div>
    </main>
  </div>;
}
