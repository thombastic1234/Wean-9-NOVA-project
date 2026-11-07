import { getRepository, HttpError } from '@/server/database';
import { checkOrigin, errorResponse, requireUser } from '@/server/http';
import { processVisionRequest } from '@/server/visionHandler';
import { verifyPhoto } from '@/lib/visionService';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    checkOrigin(request); const user = requireUser(request, ['MANAGER', 'WAITER']);
    return await processVisionRequest(request, async input => {
      const repository = getRepository(); const order = repository.read(user, input.orderId);
      if (order.status !== 'PACKAGING' || order.latestScanId !== input.scanId) throw new HttpError(409, 'Start a fresh scan on an order being packaged');
      const result = await verifyPhoto({ ...input, expectedItems: order.items.map(({ menuItemId, quantity }) => ({ menuItemId, quantity })) }, process.env.OPENROUTER_API_KEY);
      repository.recordVision(user, order.id, input.scanId, { ...result, checkedAt: new Date().toISOString() });
      return result;
    });
  } catch (error) { return errorResponse(error); }
}