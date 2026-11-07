import { endpoint } from "@/server/http";
import { checkOpenRouterKey } from "@/server/openRouter";
export const runtime = "nodejs";
export async function GET(request: Request) { return endpoint(request, ["MANAGER"], () => checkOpenRouterKey(process.env.OPENROUTER_API_KEY)); }
