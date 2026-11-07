export type StorageMode = "sqlite" | "browser_demo";
export function storageMode(): StorageMode {
  const configured = process.env.PASSCHECK_STORAGE_MODE;
  if (configured === "browser_demo" || configured === "sqlite") return configured;
  return process.env.VERCEL === "1" ? "browser_demo" : "sqlite";
}
