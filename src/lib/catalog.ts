// Person 4 owns visual descriptions. Keep these IDs stable across all roles.
export const MENU_IDS = ["burger", "fries", "milkshake", "salad"] as const;
export type MenuItemId = (typeof MENU_IDS)[number];
export const CATALOG: Record<MenuItemId, { name: string; symbol: string; visualDescription: string }> = {
  burger: { name: "Burger", symbol: "B", visualDescription: "One visible burger in a bun, or one separate demo container/card clearly labeled BURGER." },
  fries: { name: "Fries", symbol: "F", visualDescription: "One portion of fries in a single holder, or one separate demo container/card clearly labeled FRIES. Count portions, not individual fries." },
  milkshake: { name: "Milkshake", symbol: "M", visualDescription: "One visible milkshake in a clear cup or glass with a thick blended drink and visible froth or whipped topping, or one separate demo container/card clearly labeled MILKSHAKE. An unlabeled opaque cup does not establish milkshake." },
  salad: { name: "Salad", symbol: "S", visualDescription: "One visible portion of leafy salad in a bowl or clear container, or one separate demo container/card clearly labeled SALAD. Count portions, not individual leaves. Do not infer salad inside an opaque container." },
};
