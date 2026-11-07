import { handleBrowserDemo } from "@/server/browserDemo";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: Request) { return handleBrowserDemo(request); }
