import { actionSchema } from "@/lib/operations";
import { getRepository } from "@/server/database";
import { body, endpoint, projectOrder } from "@/server/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return endpoint(request, undefined, async user => ({ order: projectOrder(user, getRepository().read(user, (await context.params).id)) }));
}
export async function PATCH(request: Request, context: Context) {
  return endpoint(request, ["MANAGER", "WAITER", "CHEF", "DRIVER"], async user => {
    const input = actionSchema.parse(await body(request));
    return { order: projectOrder(user, getRepository().action(user, (await context.params).id, input)) };
  });
}
