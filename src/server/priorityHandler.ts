import { NextResponse } from "next/server";
import { priorityRequestSchema } from "@/lib/contracts";
import { prioritizeOrders } from "@/lib/priorityService";
import type { PriorityRequest } from "@/lib/contracts";

export const runtime = "nodejs";
export async function processPriorityRequest(request: Request, canonicalize?: (input: PriorityRequest) => PriorityRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = priorityRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid priority request", issues: parsed.error.issues }, { status: 400 });
  const response = await prioritizeOrders(canonicalize ? canonicalize(parsed.data) : parsed.data, process.env.OPENROUTER_API_KEY);
  return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
}
