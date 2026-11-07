import type { Order, PriorityRequest, PriorityResponse, Settings } from "./contracts";

type PriorityOrder = PriorityRequest["orders"][number];
type Ranking = PriorityResponse["ranking"];
export const MAX_AI_ORDERS = 10;
export const PRIORITY_TIMEOUT_MS = 8_000;

const elapsed = (minutes: number) => Math.max(0, minutes);
const clamp = (value: number) => Math.max(0, Math.min(value, 1));
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function priorityScore(order: PriorityOrder, settings: Settings): number {
  const slackMinutes = order.minutesUntilTargetReady - order.estimatedPrepMinutes;
  return settings.ageWeight * Math.min(elapsed(order.ageMinutes) / 20, 1)
    + settings.urgencyWeight * clamp((10 - slackMinutes) / 10)
    + settings.courierWeight * Math.min(elapsed(order.courierWaitingMinutes) / 10, 1);
}

function compareAge(a: PriorityOrder, b: PriorityOrder): number {
  return elapsed(b.ageMinutes) - elapsed(a.ageMinutes) || compareId(a.orderId, b.orderId);
}

export function maximumWaitReason(order: PriorityOrder, settings: Settings): string {
  return `Maximum wait: age ${elapsed(order.ageMinutes).toFixed(1)}m >= ${settings.maxWaitMinutes}m; oldest first.`;
}

export function fallbackRanking(request: PriorityRequest): PriorityResponse {
  const { settings } = request;
  const orders = [...request.orders].sort((a, b) => {
    const aOverdue = elapsed(a.ageMinutes) >= settings.maxWaitMinutes;
    const bOverdue = elapsed(b.ageMinutes) >= settings.maxWaitMinutes;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    return aOverdue ? compareAge(a, b) : priorityScore(b, settings) - priorityScore(a, settings) || compareAge(a, b);
  });
  return {
    requestVersion: request.requestVersion,
    mode: "fallback",
    ranking: orders.map(order => ({
      orderId: order.orderId,
      reason: elapsed(order.ageMinutes) >= settings.maxWaitMinutes ? maximumWaitReason(order, settings)
        : `Rules score ${priorityScore(order, settings).toFixed(2)}: age ${elapsed(order.ageMinutes).toFixed(1)}m; slack ${(order.minutesUntilTargetReady - order.estimatedPrepMinutes).toFixed(1)}m (target minus prep); courier ${elapsed(order.courierWaitingMinutes).toFixed(1)}m.`,
    })),
  };
}

export function hasCompleteRanking(request: PriorityRequest, response: Pick<PriorityResponse, "requestVersion" | "ranking">): boolean {
  const ids = response.ranking.map(row => row.orderId);
  const supplied = new Set(request.orders.map(order => order.orderId));
  return response.requestVersion === request.requestVersion && ids.length === supplied.size
    && new Set(ids).size === ids.length && ids.every(id => supplied.has(id));
}

// Keep the AI's relative order for everyone below the hard maximum-wait threshold.
export function applyMaximumWait(request: PriorityRequest, ranking: Ranking): Ranking {
  const overdue = request.orders.filter(order => elapsed(order.ageMinutes) >= request.settings.maxWaitMinutes).sort(compareAge);
  const overdueIds = new Set(overdue.map(order => order.orderId));
  return [...overdue.map(order => ({ orderId: order.orderId, reason: maximumWaitReason(order, request.settings) })),
    ...ranking.filter(row => !overdueIds.has(row.orderId))];
}

// Application code computes all durations. Never send timestamps for the model to interpret.
export function makePriorityRequest(orders: Order[], settings: Settings, requestVersion: number, now = Date.now()): PriorityRequest {
  return {
    requestVersion, settings,
    orders: orders.filter(order => order.status === "queued").map(order => ({
      orderId: order.id, fulfillment: order.fulfillment,
      ageMinutes: elapsed((now - Date.parse(order.createdAt)) / 60_000),
      estimatedPrepMinutes: order.estimatedPrepMinutes,
      minutesUntilTargetReady: (Date.parse(order.targetReadyAt) - now) / 60_000,
      courierWaitingMinutes: order.courierArrivedAt ? elapsed((now - Date.parse(order.courierArrivedAt)) / 60_000) : 0,
    })),
  };
}
