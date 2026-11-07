// Person 4 owns visual descriptions. Keep these IDs stable across all roles.
export const MENU_IDS = ["burger", "fries", "cola", "cookie"] as const;
export type MenuItemId = (typeof MENU_IDS)[number];
export const CATALOG: Record<MenuItemId, { name: string; symbol: string }> = {
  burger: { name: "Burger", symbol: "B" },
  fries: { name: "Fries", symbol: "F" },
  cola: { name: "Cola", symbol: "C" },
  cookie: { name: "Cookie", symbol: "K" },
};
