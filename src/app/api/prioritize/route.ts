import { NextResponse } from "next/server";
import { priorityRequestSchema, type PriorityResponse } from "@/lib/contracts";

// Person 2 replaces this transparent contract stub with AI + deterministic fallback.
// This is deliberately incoming order only, with no priority scoring implemented here.
export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = priorityRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid priority request", issues: parsed.error.issues }, { status: 400 });
  const response: PriorityResponse = {
    requestVersion: parsed.data.requestVersion, mode: "fallback",
    ranking: parsed.data.orders.map(order => ({ orderId: order.orderId, reason: "Demo arrival order · AI prioritization not connected" })),
  };
  return NextResponse.json(response);
}
