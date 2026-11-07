import { getRepository } from "@/server/database";
import { endpoint } from "@/server/http";
export const runtime = "nodejs";
export async function GET(request: Request) { return endpoint(request, ["MANAGER", "WAITER"], user => ({ users: getRepository().users().filter(account => user.role === "MANAGER" || account.role === "CUSTOMER").map(({ id, name, role }) => ({ id, name, role })) })); }
