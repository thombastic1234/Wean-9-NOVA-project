import { z } from "zod";
import { getRepository } from "@/server/database";
import { body, endpoint, projectOrder } from "@/server/http";
import { FULFILLMENTS, SOURCES, STATUSES } from "@/lib/operations";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(request, undefined, user => {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const filters = z.object({ source: z.enum(SOURCES).optional(), status: z.enum(STATUSES).optional(), fulfillment: z.enum(FULFILLMENTS).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), customerId: z.string().max(100).optional() }).parse(params);
    return { orders: getRepository().list(user, filters).map(order => projectOrder(user, order)) };
  });
}
export async function POST(request: Request) {
  return endpoint(request, ["MANAGER", "WAITER", "CUSTOMER"], async user => {
    const input = z.object({ requestId: z.uuid(), order: z.unknown() }).parse(await body(request));
    return { order: projectOrder(user, getRepository().create(user, input.order, input.requestId)) };
  });
}
