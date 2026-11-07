import { z } from "zod";
import { getRepository } from "@/server/database";
import { body, checkOrigin, demoEnabled, errorResponse, json, withSession } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!demoEnabled()) return json({ error: "Not found" }, 404);
  try {
    checkOrigin(request);
    const input = z.object({ userId: z.enum(["demo-manager", "demo-customer", "demo-customer-other", "demo-waiter", "demo-chef", "demo-driver", "demo-driver-other"]) }).parse(await body(request, 1000));
    getRepository().seedDemo(); return withSession(request, getRepository().user(input.userId)!);
  } catch (error) { return errorResponse(error); }
}
