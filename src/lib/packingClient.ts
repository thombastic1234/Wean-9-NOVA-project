import { hasCompletedCheck, visionResponseSchema, type Order, type VisionResponse } from "./contracts";
import { appFetch } from "./apiClient";

export type PhotoCheckRequest = {
  orderId: string;
  scanId: string;
  imageDataUrl: string;
  expectedItems: Order["items"];
};

// Recognition and count comparison belong to Person 4; validate their result here.
export async function checkPackingPhoto(request: PhotoCheckRequest, signal: AbortSignal): Promise<VisionResponse> {
  const response = await appFetch("/api/verify", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ ...request, expectedItems: request.expectedItems.map(({ menuItemId, quantity }) => ({ menuItemId, quantity })) }),
  });
  if (!response.ok) {
    const messages: Record<number, string> = {
      400: "The photo check request was rejected. Choose another JPEG or PNG, or check manually.",
      413: "The photo is too large for verification. Choose a smaller JPEG or PNG, or check manually.",
      503: "Vision verification is unavailable. Retry later or complete the manual checklist.",
    };
    throw new Error(messages[response.status] ?? "Photo verification failed. Retry or complete the manual checklist.");
  }
  const parsed = visionResponseSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.orderId !== request.orderId || parsed.data.scanId !== request.scanId) {
    throw new Error("The photo service returned an invalid or outdated result. Recheck or check manually.");
  }
  if (parsed.data.result === "match" && !hasCompletedCheck({
    id: request.orderId, items: request.expectedItems,
    verification: { ...parsed.data, checkedAt: new Date().toISOString() },
  } as Order)) {
    throw new Error("The returned counts do not support a match. Recheck or check manually.");
  }
  return parsed.data;
}

export async function preparePackingPhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/png"].includes(file.type)) throw new Error("Choose a JPEG or PNG photo.");
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("Choose a nonempty photo smaller than 20 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) {
      throw new Error("Choose a photo up to 40 megapixels.");
    }
    const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not prepare this photo. Try another browser or check manually.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    if (!dataUrl.startsWith("data:image/jpeg;base64,") || dataUrl.length > 6_000_000) {
      throw new Error("The prepared photo is too large. Choose a smaller photo.");
    }
    return dataUrl;
  } catch (error) {
    if (error instanceof DOMException) throw new Error("This photo could not be opened. Choose a valid JPEG or PNG.");
    throw error;
  } finally { URL.revokeObjectURL(url); }
}
