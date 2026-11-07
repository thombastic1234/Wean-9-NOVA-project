import { getRepository } from "@/server/database";
import { demoEnabled, endpoint, json } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!demoEnabled()) return json({ error: "Not found" }, 404);
  return endpoint(request, ["MANAGER"], () => { getRepository().seedDemo(true); return { ok: true }; });
}
