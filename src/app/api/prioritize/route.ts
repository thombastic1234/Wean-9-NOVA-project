import { makePriorityRequest } from '@/lib/priority';
import { toPackingOrder } from '@/lib/operations';
import { getRepository, HttpError } from '@/server/database';
import { checkOrigin, errorResponse, requireUser } from '@/server/http';
import { processPriorityRequest } from '@/server/priorityHandler';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    checkOrigin(request); const user = requireUser(request, ['MANAGER', 'CHEF']);
    return await processPriorityRequest(request, input => {
      const repository = getRepository();
      const orders = input.orders.map(row => repository.read(user, row.orderId));
      if (orders.some(order => order.status !== 'PLACED')) throw new HttpError(409, 'Only placed orders may be prioritized');
      return makePriorityRequest(orders.map(toPackingOrder), repository.settings(), input.requestVersion);
    });
  } catch (error) { return errorResponse(error); }
}