import { priorityResponseSchema, type PriorityRequest, type PriorityResponse } from "./contracts";
import { applyMaximumWait, fallbackRanking, hasCompleteRanking, PRIORITY_TIMEOUT_MS } from "./priority";
import { appFetch } from "./apiClient";

export type PriorityOutcome = { response: PriorityResponse; error: string | null };

export async function requestPriority(request: PriorityRequest, signal?: AbortSignal): Promise<PriorityOutcome> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(cancel, PRIORITY_TIMEOUT_MS);
  try {
    const response = await appFetch("/api/prioritize", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request), signal: controller.signal,
    });
    if (!response.ok) throw new Error("Priority service unavailable");
    const result = priorityResponseSchema.parse(await response.json());
    if (!hasCompleteRanking(request, result)) throw new Error("Incomplete or stale ranking");
    return { response: { ...result, ranking: applyMaximumWait(request, result.ranking) }, error: null };
  } catch {
    return { response: fallbackRanking(request), error: "Priority service unavailable or invalid response. Rules fallback active." };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
