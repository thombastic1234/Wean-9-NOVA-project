import { NextResponse } from "next/server";
import { verifyRequestSchema } from "@/lib/contracts";

// Person 4 owns vision, prompt, catalog descriptions, and code-based count comparison.
// Never manufacture a successful verification when no vision provider is connected.
export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = verifyRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid verification request" }, { status: 400 });
  return NextResponse.json({ error: "Vision verification is not connected. Complete the manual checklist.", orderId: parsed.data.orderId, scanId: parsed.data.scanId }, { status: 503 });
}
