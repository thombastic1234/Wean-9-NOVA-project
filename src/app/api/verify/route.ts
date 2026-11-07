import { NextResponse } from "next/server";
import { verifyRequestSchema } from "@/lib/contracts";
import { verifyPhoto } from "@/lib/visionService";

export const runtime = "nodejs";
const MAX_VERIFY_BYTES = 4 * 1024 * 1024;
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_VERIFY_BYTES) {
    return NextResponse.json({ error: "Verification request exceeds 4 MB" }, { status: 413 });
  }
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "Missing request body" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  let body: unknown;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_VERIFY_BYTES) {
        void reader.cancel().catch(() => {});
        return NextResponse.json({ error: "Verification request exceeds 4 MB" }, { status: 413 });
      }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  finally { reader.releaseLock(); }
  const parsed = verifyRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid verification request" }, { status: 400 });
  const { imageDataUrl } = parsed.data;
  const encoded = imageDataUrl.slice(imageDataUrl.indexOf(",") + 1);
  const bytes = Buffer.from(encoded, "base64");
  const validSignature = imageDataUrl.startsWith("data:image/png;")
    ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!validSignature || bytes.toString("base64") !== encoded) {
    return NextResponse.json({ error: "Invalid JPEG/PNG image encoding" }, { status: 400 });
  }
  return NextResponse.json(await verifyPhoto(parsed.data, process.env.OPENROUTER_API_KEY));
}
