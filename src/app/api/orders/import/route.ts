import { z } from "zod";
import { getRepository } from "@/server/database";
import { body, endpoint } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) { return endpoint(request, ["MANAGER"], async user => ({ imported: getRepository().importLegacy(user, z.object({ orders: z.unknown() }).parse(await body(request, 2_000_000)).orders) })); }
