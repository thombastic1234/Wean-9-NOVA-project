import { z } from "zod";
import { MENU_IDS } from "./catalog";
import { aiDiagnosticSchema } from "./aiDiagnostics";

const timestamp = z.iso.datetime({ offset: true });
const quantity = z.number().int().nonnegative().max(100);
export const countSchema = z.object({ menuItemId: z.enum(MENU_IDS), quantity });
export const visionResponseSchema = z.object({
  orderId: z.string().min(1),
  scanId: z.string().min(1),
  result: z.enum(["match", "mismatch", "review_needed"]),
  observed: z.array(countSchema),
  missing: z.array(countSchema),
  extra: z.array(countSchema),
  unknownItems: z.array(z.string()),
  uncertainties: z.array(z.string()),
}).superRefine((value, ctx) => {
  if (value.result === "match" && (value.missing.some(i => i.quantity > 0) || value.extra.some(i => i.quantity > 0) || value.unknownItems.length || value.uncertainties.length)) {
    ctx.addIssue({ code: "custom", message: "A match cannot contain discrepancies or uncertainties" });
  }
});
export const verificationSchema = z.object({
  orderId: z.string().min(1), scanId: z.string().min(1),
  result: z.enum(["match", "mismatch", "review_needed", "manual_checked"]),
  observed: z.array(countSchema), missing: z.array(countSchema), extra: z.array(countSchema),
  unknownItems: z.array(z.string()), uncertainties: z.array(z.string()), checkedAt: timestamp,
});
export type VisionResponse = z.infer<typeof visionResponseSchema>;
export type Verification = z.infer<typeof verificationSchema>;
export const orderSchema = z.object({
  id: z.string().min(1), source: z.enum(["waiter", "online"]), sourceOrderId: z.string().min(1),
  fulfillment: z.enum(["dine_in", "delivery", "takeaway"]), tableNumber: z.string().nullable(),
  items: z.array(z.object({ menuItemId: z.enum(MENU_IDS), name: z.string(), quantity: quantity.refine(n => n > 0) })).min(1),
  createdAt: timestamp, targetReadyAt: timestamp, estimatedPrepMinutes: z.number().positive(),
  courierArrivedAt: timestamp.nullable(), status: z.enum(["queued", "cooking", "packing", "ready", "collected"]),
  startedAt: timestamp.nullable(), cookedAt: timestamp.nullable(), readyAt: timestamp.nullable(),
  collectedAt: timestamp.nullable(), handoffLocation: z.string().nullable(), pickupCode: z.string().nullable(),
  packingConfirmedAt: timestamp.nullable(), verification: verificationSchema.nullable(),
});
export type Order = z.infer<typeof orderSchema>;
export const settingsSchema = z.object({
  ageWeight: z.number().int().min(0).max(10), urgencyWeight: z.number().int().min(0).max(10),
  courierWeight: z.number().int().min(0).max(10), maxWaitMinutes: z.number().int().min(5).max(120),
});
export type Settings = z.infer<typeof settingsSchema>;
export const priorityRequestSchema = z.object({
  requestVersion: z.number().int().nonnegative(), settings: settingsSchema,
  orders: z.array(z.object({
    orderId: z.string().trim().min(1).max(100), fulfillment: z.enum(["dine_in", "delivery", "takeaway"]), ageMinutes: z.number().nonnegative(),
    estimatedPrepMinutes: z.number().positive(), minutesUntilTargetReady: z.number(), courierWaitingMinutes: z.number().nonnegative(),
  })).refine(orders => new Set(orders.map(order => order.orderId)).size === orders.length, "Duplicate order IDs"),
});
export const priorityResponseSchema = z.object({
  requestVersion: z.number().int().nonnegative(), mode: z.enum(["ai", "fallback"]),
  ranking: z.array(z.object({ orderId: z.string().min(1), reason: z.string().trim().min(1).max(240) })),
  diagnostic: aiDiagnosticSchema.optional(),
});
export type PriorityRequest = z.infer<typeof priorityRequestSchema>;
export type PriorityResponse = z.infer<typeof priorityResponseSchema>;
export const verifyRequestSchema = z.object({
  orderId: z.string().trim().min(1).max(100), scanId: z.string().trim().min(1).max(100),
  imageDataUrl: z.string().max(4 * 1024 * 1024).regex(/^data:image\/(jpeg|png);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  expectedItems: z.array(countSchema.extend({ quantity: z.number().int().positive().max(100) })).min(1).max(100)
    .refine(items => MENU_IDS.every(id => items.filter(item => item.menuItemId === id).reduce((sum, item) => sum + item.quantity, 0) <= 100), "Aggregated counts must not exceed 100 per menu ID"),
});
export const DEFAULT_SETTINGS: Settings = { ageWeight: 3, urgencyWeight: 5, courierWeight: 4, maxWaitMinutes: 20 };
export const LOCATIONS = { delivery: ["Shelf A1", "Shelf A2"], takeaway: ["Shelf A1", "Shelf A2"], dine_in: ["Pass 1", "Pass 2"] } as const;

export function hasCompletedCheck(order: Order): boolean {
  const v = order.verification;
  if (!v || v.orderId !== order.id) return false;
  if (v.result !== "match" && v.result !== "manual_checked") return false;
  if (v.missing.some(i => i.quantity > 0) || v.extra.some(i => i.quantity > 0) || v.unknownItems.length || v.uncertainties.length) return false;
  const counts = new Map<string, number>();
  for (const item of v.observed) counts.set(item.menuItemId, (counts.get(item.menuItemId) ?? 0) + item.quantity);
  const expected = new Map<string, number>();
  for (const item of order.items) expected.set(item.menuItemId, (expected.get(item.menuItemId) ?? 0) + item.quantity);
  return MENU_IDS.every(id => (counts.get(id) ?? 0) === (expected.get(id) ?? 0));
}
export function canMarkReady(order: Order): boolean {
  return order.status === "packing" && hasCompletedCheck(order) && Boolean(order.packingConfirmedAt)
    && LOCATIONS[order.fulfillment].some(location => location === order.handoffLocation);
}
