import { z } from "zod";
import { getRepository, HttpError } from "@/server/database";
import { authenticateFixedAccount, isFixedSession, isFixedUsername } from "@/server/fixedAccounts";
import { storageMode } from "@/server/storageMode";
import { body, checkOrigin, COOKIE_NAME, demoEnabled, errorResponse, json, requireUser, sessionToken, withSession } from "@/server/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { return json({ user: requireUser(request), demoEnabled: demoEnabled(), storageMode: storageMode() }); }
  catch { return json({ user: null, demoEnabled: demoEnabled(), storageMode: storageMode() }); }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const input = z.object({ username: z.string().trim().min(1).max(200).optional(), email: z.string().trim().min(1).max(200).optional(), password: z.string().min(1).max(128) }).parse(await body(request, 2000));
    const identifier = input.username ?? input.email;
    if (!identifier) throw new HttpError(400, "Username is required");
    if (isFixedUsername(identifier)) {
      const user = authenticateFixedAccount(identifier, input.password);
      if (!user) throw new HttpError(401, "Username or password is incorrect");
      return withSession(request, user);
    }
    if (!z.email().safeParse(identifier).success) throw new HttpError(401, "Username or password is incorrect");
    return withSession(request, getRepository().login(identifier, input.password));
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  try {
    checkOrigin(request); const token = sessionToken(request); if (token && !isFixedSession(token)) getRepository().logout(token);
    const response = json({ ok: true }); response.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" }); return response;
  } catch (error) { return errorResponse(error); }
}
