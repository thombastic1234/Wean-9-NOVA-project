import { canMarkReady, DEFAULT_SETTINGS, hasCompletedCheck, LOCATIONS, orderSchema, priorityResponseSchema, settingsSchema, verificationSchema, type Order, type PriorityResponse, type Settings, type Verification } from "./contracts";
import { seedOrders } from "./fixtures";
import { z } from "zod";

export type State = {
  hydrated: boolean; orders: Order[]; settings: Settings; latestScanIds: Record<string, string>;
  priorityVersion: number; ranking: PriorityResponse | null; resetToken: number;
};
export const initialState: State = { hydrated: false, orders: [], settings: DEFAULT_SETTINGS, latestScanIds: {}, priorityVersion: 0, ranking: null, resetToken: 0 };
export type Action =
  | { type: "hydrate"; orders: Order[]; settings: Settings }
  | { type: "ingest"; order: Order }
  | { type: "start" | "finish" | "ready" | "collect" | "courier"; orderId: string; at: string }
  | { type: "scan_started"; orderId: string; scanId: string }
  | { type: "verification"; orderId: string; verification: Verification }
  | { type: "confirm_packing"; orderId: string; at: string; confirmed: boolean }
  | { type: "location"; orderId: string; location: string }
  | { type: "settings"; settings: Settings }
  | { type: "refresh_priority" }
  | { type: "ranking"; response: PriorityResponse }
  | { type: "reset"; now: number };

function invalidate(state: State): State {
  return { ...state, priorityVersion: state.priorityVersion + 1, ranking: null };
}
export function reducer(state: State, action: Action): State {
  if (action.type === "hydrate") {
    if (state.hydrated) return state;
    return invalidate({ ...state, hydrated: true, orders: action.orders, settings: action.settings });
  }
  if (!state.hydrated) return state;
  if (action.type === "reset") return { ...initialState, hydrated: true, orders: seedOrders(action.now), priorityVersion: state.priorityVersion + 1, resetToken: state.resetToken + 1 };
  if (action.type === "settings") {
    const parsed = settingsSchema.safeParse(action.settings);
    return parsed.success ? invalidate({ ...state, settings: parsed.data }) : state;
  }
  if (action.type === "refresh_priority") return invalidate(state);
  if (action.type === "ranking") {
    const parsed = priorityResponseSchema.safeParse(action.response);
    if (!parsed.success || parsed.data.requestVersion !== state.priorityVersion) return state;
    const ids = state.orders.filter(o => o.status === "queued").map(o => o.id);
    const rankedIds = parsed.data.ranking.map(r => r.orderId);
    if (new Set(rankedIds).size !== rankedIds.length || ids.length !== rankedIds.length || ids.some(id => !rankedIds.includes(id))) return state;
    return { ...state, ranking: parsed.data };
  }
  if (action.type === "ingest") {
    const parsed = orderSchema.safeParse(action.order);
    if (!parsed.success || parsed.data.status !== "queued" || state.orders.some(o => o.id === action.order.id || (o.source === action.order.source && o.sourceOrderId === action.order.sourceOrderId))) return state;
    return invalidate({ ...state, orders: [...state.orders, { ...parsed.data, startedAt: null, cookedAt: null, readyAt: null, collectedAt: null, verification: null, packingConfirmedAt: null, handoffLocation: null, pickupCode: null }] });
  }
  const order = state.orders.find(o => o.id === action.orderId);
  if (!order) return state;
  let updated = order;
  let latestScanIds = state.latestScanIds;
  switch (action.type) {
    case "start":
      if (order.status !== "queued") return state;
      updated = { ...order, status: "cooking", startedAt: action.at }; break;
    case "finish":
      if (order.status !== "cooking") return state;
      updated = { ...order, status: "packing", cookedAt: action.at, verification: null, packingConfirmedAt: null }; break;
    case "courier":
      if (order.fulfillment !== "delivery" || order.status !== "queued" || order.courierArrivedAt) return state;
      updated = { ...order, courierArrivedAt: action.at }; break;
    case "scan_started":
      if (order.status !== "packing" || !action.scanId) return state;
      latestScanIds = { ...latestScanIds, [order.id]: action.scanId };
      updated = { ...order, verification: null, packingConfirmedAt: null }; break;
    case "verification": {
      const parsed = verificationSchema.safeParse(action.verification);
      if (order.status !== "packing" || !parsed.success || parsed.data.orderId !== order.id || parsed.data.scanId !== state.latestScanIds[order.id]) return state;
      updated = { ...order, verification: parsed.data, packingConfirmedAt: null }; break;
    }
    case "confirm_packing":
      if (order.status !== "packing" || (action.confirmed && !hasCompletedCheck(order))) return state;
      updated = { ...order, packingConfirmedAt: action.confirmed ? action.at : null }; break;
    case "location":
      if (order.status !== "packing" || !LOCATIONS[order.fulfillment].some(l => l === action.location)) return state;
      updated = { ...order, handoffLocation: action.location }; break;
    case "ready":
      if (!canMarkReady(order)) return state;
      updated = { ...order, status: "ready", readyAt: action.at, pickupCode: `P${order.id.replace(/[^A-Za-z0-9]/g, "")}` }; break;
    case "collect":
      if (order.status !== "ready") return state;
      updated = { ...order, status: "collected", collectedAt: action.at }; break;
  }
  const next = { ...state, latestScanIds, orders: state.orders.map(o => o.id === updated.id ? updated : o) };
  return action.type === "start" || action.type === "courier" ? invalidate(next) : next;
}

export const STORAGE_KEY = "passcheck.demo.v1";
const savedSchema = z.object({ version: z.literal(1), orders: z.array(orderSchema), settings: settingsSchema });
export function serializeState(state: State): string {
  return JSON.stringify({ version: 1, orders: state.orders, settings: state.settings });
}
export function restoreState(raw: string): { orders: Order[]; settings: Settings } {
  const parsed = savedSchema.parse(JSON.parse(raw));
  const ids = new Set<string>();
  const sources = new Set<string>();
  for (const order of parsed.orders) {
    const source = `${order.source}:${order.sourceOrderId}`;
    if (ids.has(order.id) || sources.has(source)) throw new Error("Duplicate saved order");
    ids.add(order.id); sources.add(source);
    // Saved state must never place an unchecked order on the pickup board.
    if (order.status === "ready" && (!hasCompletedCheck(order) || !order.packingConfirmedAt || !order.pickupCode || !order.readyAt || !LOCATIONS[order.fulfillment].some(l => l === order.handoffLocation))) throw new Error("Invalid saved ready order");
  }
  return { orders: parsed.orders, settings: parsed.settings };
}
