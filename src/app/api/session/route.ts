import { z } from "zod";
import { getRepository } from "@/server/database";
import { body, checkOrigin, COOKIE_NAME, demoEnabled, errorResponse, json, requireUser, sessionToken, withSession } from "@/server/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { return json({ user: requireUser(request), demoEnabled: demoEnabled() }); }
  catch { return json({ user: null, demoEnabled: demoEnabled() }); }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const input = z.object({ email: z.email().max(200), password: z.string().min(1).max(128) }).parse(await body(request, 2000));
    return withSession(request, getRepository().login(input.email, input.password));
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  try {
    checkOrigin(request); const token = sessionToken(request); if (token) getRepository().logout(token);
    const response = json({ ok: true }); response.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" }); return response;
  } catch (error) { return errorResponse(error); }
}
