import { CATALOG, type MenuItemId } from "./catalog";
import { type Order } from "./contracts";

export function makeOrder(source: Order["source"], sourceOrderId: string, now = Date.now(), offset = 0): Order {
  const menus: MenuItemId[][] = [["burger", "fries", "cola"], ["burger", "cookie"], ["fries", "cola", "cookie"], ["burger", "fries"]];
  const number = Number(sourceOrderId.replace(/\D/g, "")) || 1;
  return {
    id: `${source === "online" ? "ON" : "IN"}-${sourceOrderId}`,
    source, sourceOrderId, fulfillment: source === "online" ? "delivery" : "dine_in",
    tableNumber: source === "waiter" ? String(number % 8 + 1).padStart(2, "0") : null,
    items: menus[number % menus.length].map(menuItemId => ({ menuItemId, name: CATALOG[menuItemId].name, quantity: menuItemId === "burger" && number % 3 === 0 ? 2 : 1 })),
    createdAt: new Date(now - offset * 60_000).toISOString(), targetReadyAt: new Date(now + (15 - offset) * 60_000).toISOString(),
    estimatedPrepMinutes: 6 + number % 5,
    courierArrivedAt: source === "online" && offset >= 8 ? new Date(now - 2 * 60_000).toISOString() : null,
    status: "queued", startedAt: null, cookedAt: null, readyAt: null, collectedAt: null,
    handoffLocation: null, pickupCode: null, packingConfirmedAt: null, verification: null,
  };
}
export function seedOrders(now = Date.now()): Order[] {
  return Array.from({ length: 6 }, (_, i) => makeOrder(i % 2 === 0 ? "online" : "waiter", String(1041 + i), now, 12 - i * 2));
}
