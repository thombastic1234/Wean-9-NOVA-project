// Person 4 owns visual descriptions. Keep these IDs stable across all roles.
export const MENU_IDS = ["burger", "fries", "cola", "cookie"] as const;
export type MenuItemId = (typeof MENU_IDS)[number];
export const CATALOG: Record<MenuItemId, { name: string; symbol: string; visualDescription: string }> = {
  burger: { name: "Burger", symbol: "B", visualDescription: "One visible burger in a bun, or one separate demo container/card clearly labeled BURGER." },
  fries: { name: "Fries", symbol: "F", visualDescription: "One portion of fries in a single holder, or one separate demo container/card clearly labeled FRIES. Count portions, not individual fries." },
  cola: { name: "Cola", symbol: "C", visualDescription: "One drink container visibly labeled COLA. An unlabeled opaque cup does not establish cola." },
  cookie: { name: "Cookie", symbol: "K", visualDescription: "One visible round cookie, or one separate demo container/card clearly labeled COOKIE." },
};
