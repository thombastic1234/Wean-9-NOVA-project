export const BROWSER_WORKSPACE_KEY = "passcheck.browser-workspace.v1";
let browserDemo = false;
let workspaceQueue: Promise<unknown> = Promise.resolve();
export function configureBrowserDemo(enabled: boolean) { browserDemo = enabled; }
function statefulPath(url: string) {
  const path = url.split("?")[0];
  return path === "/api/users" || path === "/api/settings" || path === "/api/verify" || path === "/api/prioritize" || path === "/api/orders" || path.startsWith("/api/orders/");
}
export async function resetBrowserDemo() {
  const reset = workspaceQueue.then(() => { window.localStorage.removeItem(BROWSER_WORKSPACE_KEY); });
  workspaceQueue = reset.catch(() => {}); return reset;
}
export function appFetch(url: string, options: RequestInit = {}): Promise<Response> {
  if (!browserDemo || typeof window === "undefined" || !statefulPath(url)) return fetch(url, options);
  // All reads and writes use the latest encrypted workspace. Never let a polling
  // response overwrite a packing action, or rely on a particular Vercel instance.
  const task = workspaceQueue.then(async () => {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const workspace = window.localStorage.getItem(BROWSER_WORKSPACE_KEY);
    if (options.body !== undefined && typeof options.body !== "string") throw new Error("The browser demo accepts JSON requests only");
    const response = await fetch("/api/browser-demo", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: options.signal,
      body: JSON.stringify({ path: url, method: options.method ?? "GET", ...(options.body === undefined ? {} : { body: options.body }), workspace }) });
    if (!response.ok) return response;
    const envelope = await response.json();
    if (typeof envelope.workspace !== "string" || !Number.isInteger(envelope.status) || envelope.status < 200 || envelope.status > 599 || !("data" in envelope)) throw new Error("Invalid browser demo response");
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try { window.localStorage.setItem(BROWSER_WORKSPACE_KEY, envelope.workspace); }
    catch { throw new Error("The browser could not save this demo. Enable browser storage or reset the demo."); }
    return new Response(JSON.stringify(envelope.data), { status: envelope.status, headers: { "Content-Type": "application/json" } });
  });
  workspaceQueue = task.catch(() => {});
  return task;
}

export async function api<T = Record<string, unknown>>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers); if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await appFetch(url, { ...options, cache: "no-store", headers });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Request failed");
  if (url === "/api/session" && "storageMode" in value) configureBrowserDemo(value.storageMode === "browser_demo");
  return value as T;
}
