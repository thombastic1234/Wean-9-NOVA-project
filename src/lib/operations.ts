import { z } from "zod";
import { CATALOG, MENU_IDS } from "./catalog";
import { hasCompletedCheck, type Order as LegacyOrder, type Verification } from "./contracts";

export const ROLES = ["MANAGER", "CUSTOMER", "WAITER", "CHEF", "DRIVER"] as const;
export type Role = typeof ROLES[number];
export type User = { id: string; name: string; email: string; role: Role };
export const SOURCES = ["IN_PERSON", "ONLINE"] as const;
export const FULFILLMENTS = ["DINE_IN", "TAKEAWAY", "DELIVERY"] as const;
export const STATUSES = ["PLACED", "PREPARING", "READY_TO_PACKAGE", "PACKAGING", "READY_TO_SERVE", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED"] as const;
export type Status = typeof STATUSES[number];
export const MENU_PRICES = { burger: 900, fries: 400, milkshake: 600, salad: 700 } as const;
export type HistoryEntry = { previousStatus: Status | null; newStatus: Status; at: string; actorId: string; actorName: string; action: string; note?: string };
export type OperationalOrder = {
  id: string; sourceOrderId: string; source: typeof SOURCES[number]; fulfillment: typeof FULFILLMENTS[number];
  customerId: string | null; customerName: string; createdBy: string; createdByName: string;
  chefId: string | null; chefName: string | null; driverId: string | null; driverName: string | null;
  tableNumber: string | null; deliveryAddress: string; contact: string; notes: string;
  items: Array<{ menuItemId: typeof MENU_IDS[number]; name: string; quantity: number; options: string[]; notes: string; unitPriceCents: number | null }>;
  totalCents: number | null; status: Status; revision: number; createdAt: string; updatedAt: string;
  startedAt: string | null; cookedAt: string | null; packagingStartedAt: string | null;
  packingConfirmedAt: string | null; readyAt: string | null; pickedUpAt: string | null;
  completedAt: string | null; cancelledAt: string | null; handoffLocation: string | null; pickupCode: string | null;
  latestScanId: string | null; verification: Verification | null; history: HistoryEntry[];
};
export const createOrderSchema = z.object({
  source: z.enum(SOURCES), fulfillment: z.enum(FULFILLMENTS), customerId: z.string().min(1).nullable().optional(),
  customerName: z.string().trim().max(100).default("Guest"), tableNumber: z.string().trim().max(30).default(""),
  deliveryAddress: z.string().trim().max(500).default(""), contact: z.string().trim().max(100).default(""), notes: z.string().trim().max(1000).default(""),
  items: z.array(z.object({ menuItemId: z.enum(MENU_IDS), quantity: z.number().int().min(1).max(30),
    options: z.array(z.string().trim().min(1).max(100)).max(8).default([]), notes: z.string().trim().max(300).default("") })).min(1).max(4),
}).superRefine((data, ctx) => {
  if (new Set(data.items.map(i => i.menuItemId)).size !== data.items.length) ctx.addIssue({ code: "custom", message: "Use one line per menu item" });
  if (data.fulfillment === "DINE_IN" && !data.tableNumber) ctx.addIssue({ code: "custom", message: "Table is required for dine-in" });
  if (data.fulfillment === "DELIVERY" && !data.deliveryAddress) ctx.addIssue({ code: "custom", message: "Delivery address is required" });
});
export const ACTIONS = ["start_preparation", "finish_preparation", "start_packaging", "scan_started", "verification", "confirm_packing", "location", "finish_packaging", "serve", "collect", "claim", "assign_driver", "pickup", "deliver", "cancel", "associate_customer", "delivery_details"] as const;
export type Operation = typeof ACTIONS[number];
export const actionSchema = z.object({
  action: z.enum(ACTIONS), revision: z.number().int().nonnegative(), requestId: z.string().uuid(),
  scanId: z.string().min(1).max(100).optional(), verification: z.unknown().optional(),
  confirmed: z.boolean().optional(), location: z.string().max(30).optional(), userId: z.string().max(100).optional(), reason: z.string().trim().max(500).optional(),
  deliveryAddress: z.string().trim().min(1).max(500).optional(), contact: z.string().trim().max(100).optional(),
});
export const STATUS_LABELS: Record<Status, string> = {
  PLACED: "Order received", PREPARING: "Being prepared", READY_TO_PACKAGE: "Ready for packaging", PACKAGING: "Being packaged",
  READY_TO_SERVE: "Ready to serve", READY_FOR_PICKUP: "Ready for pickup", OUT_FOR_DELIVERY: "Out for delivery", COMPLETED: "Completed", CANCELLED: "Cancelled",
};
export const SOURCE_LABELS = { IN_PERSON: "In-Person Orders", ONLINE: "Online Orders" };
export const FULFILLMENT_LABELS = { DINE_IN: "Dine-in", TAKEAWAY: "Takeaway", DELIVERY: "Delivery" };
export function canViewRole(user: User, role: Role) { return user.role === "MANAGER" || user.role === role; }
export function canReadOrder(user: User, order: OperationalOrder) {
  if (user.role === "CUSTOMER") return order.customerId === user.id;
  if (user.role === "DRIVER") return order.fulfillment === "DELIVERY" && (!order.driverId || order.driverId === user.id);
  return true;
}
export function allowedActions(user: User, order: OperationalOrder): Operation[] {
  if (!canReadOrder(user, order)) return [];
  if (order.status === "CANCELLED" || order.status === "COMPLETED") return user.role === "MANAGER" ? ["associate_customer"] : [];
  const manager = user.role === "MANAGER";
  const actions: Operation[] = [];
  if (manager || user.role === "CHEF") {
    if (order.status === "PLACED") actions.push("start_preparation");
    if (order.status === "PREPARING") actions.push("finish_preparation");
  }
  if (manager || user.role === "WAITER") {
    if (order.fulfillment === "DELIVERY" && order.status !== "OUT_FOR_DELIVERY") actions.push("delivery_details");
    if (order.status === "READY_TO_PACKAGE") actions.push("start_packaging");
    if (order.status === "PACKAGING") actions.push("scan_started", "verification", "confirm_packing", "location", "finish_packaging");
    if (order.status === "READY_TO_SERVE") actions.push("serve");
    if (order.status === "READY_FOR_PICKUP" && order.fulfillment === "TAKEAWAY") actions.push("collect");
  }
  if ((manager || user.role === "DRIVER") && order.fulfillment === "DELIVERY") {
    if (!order.driverId && !manager) actions.push("claim");
    if (manager) actions.push("assign_driver");
    if ((manager || order.driverId === user.id) && order.driverId) {
      if (order.status === "READY_FOR_PICKUP") actions.push("pickup");
      if (order.status === "OUT_FOR_DELIVERY") actions.push("deliver");
    }
  }
  if (manager) actions.push("cancel", "associate_customer");
  return actions;
}

// Compatibility boundary: reuse the established packing and priority contracts.
// This adapter never owns status; operational order records remain authoritative.
export function toPackingOrder(order: OperationalOrder): LegacyOrder {
  return {
    id: order.id, source: order.source === "IN_PERSON" ? "waiter" : "online", sourceOrderId: order.sourceOrderId,
    fulfillment: order.fulfillment === "DINE_IN" ? "dine_in" : order.fulfillment === "TAKEAWAY" ? "takeaway" : "delivery", tableNumber: order.tableNumber,
    items: order.items.map(({ menuItemId, name, quantity }) => ({ menuItemId, name, quantity })),
    createdAt: order.createdAt, targetReadyAt: new Date(Date.parse(order.createdAt) + 20 * 60_000).toISOString(), estimatedPrepMinutes: 8,
    courierArrivedAt: null, status: order.status === "PLACED" ? "queued" : order.status === "PREPARING" ? "cooking" : order.status === "READY_TO_PACKAGE" || order.status === "PACKAGING" ? "packing" : order.status === "READY_FOR_PICKUP" || order.status === "READY_TO_SERVE" ? "ready" : "collected",
    startedAt: order.startedAt, cookedAt: order.cookedAt, readyAt: order.readyAt, collectedAt: order.pickedUpAt ?? order.completedAt,
    handoffLocation: order.handoffLocation, pickupCode: order.pickupCode, packingConfirmedAt: order.packingConfirmedAt, verification: order.verification,
  };
}
export function packingIsComplete(order: OperationalOrder) {
  return order.fulfillment !== "DINE_IN" && hasCompletedCheck(toPackingOrder(order)) && Boolean(order.packingConfirmedAt)
    && ["Shelf A1", "Shelf A2"].includes(order.handoffLocation ?? "");
}
export function progressSteps(order: Pick<OperationalOrder, "fulfillment">): Status[] {
  if (order.fulfillment === "DINE_IN") return ["PLACED", "PREPARING", "READY_TO_SERVE", "COMPLETED"];
  const steps: Status[] = ["PLACED", "PREPARING", "READY_TO_PACKAGE", "PACKAGING", "READY_FOR_PICKUP"];
  return order.fulfillment === "DELIVERY" ? [...steps, "OUT_FOR_DELIVERY", "COMPLETED"] : [...steps, "COMPLETED"];
}
export function formatMoney(cents: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }
export function menuName(id: typeof MENU_IDS[number]) { return CATALOG[id].name; }
