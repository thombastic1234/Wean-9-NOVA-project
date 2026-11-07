import { getRepository } from "@/server/database";
import { body, endpoint } from "@/server/http";
export const runtime = "nodejs";
export async function GET(request: Request) { return endpoint(request, ["MANAGER", "CHEF"], () => ({ settings: getRepository().settings() })); }
export async function PUT(request: Request) { return endpoint(request, ["MANAGER"], async user => ({ settings: getRepository().updateSettings(user, await body(request)) })); }
