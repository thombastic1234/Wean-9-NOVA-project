import { z } from "zod";
import { Repository, HttpError } from "./database";
import { body, checkOrigin, errorResponse, json, requireUser } from "./http";
import { fixedAccount } from "./fixedAccounts";
import { storageMode } from "./storageMode";
import { repositoryContext } from "./repositoryContext";
import { decodeWorkspace, encodeWorkspace } from "./workspaceCodec";
import { GET as ordersGET, POST as ordersPOST } from "../app/api/orders/route";
import { GET as orderGET, PATCH as orderPATCH } from "../app/api/orders/[id]/route";
import { POST as importPOST } from "../app/api/orders/import/route";
import { GET as usersGET } from "../app/api/users/route";
import { GET as settingsGET, PUT as settingsPUT } from "../app/api/settings/route";
import { POST as verifyPOST } from "../app/api/verify/route";
import { POST as priorityPOST } from "../app/api/prioritize/route";

async function dispatch(request: Request) {
  const path = new URL(request.url).pathname;
  const method = request.method;
  if (path === "/api/orders" && method === "GET") return ordersGET(request);
  if (path === "/api/orders" && method === "POST") return ordersPOST(request);
  if (path === "/api/orders/import" && method === "POST") return importPOST(request);
  const match = /^\/api\/orders\/([A-Za-z0-9-]+)$/.exec(path);
  if (match && (method === "GET" || method === "PATCH")) {
    const context = { params: Promise.resolve({ id: match[1] }) };
    return method === "GET" ? orderGET(request, context) : orderPATCH(request, context);
  }
  if (path === "/api/users" && method === "GET") return usersGET(request);
  if (path === "/api/settings" && method === "GET") return settingsGET(request);
  if (path === "/api/settings" && method === "PUT") return settingsPUT(request);
  if (path === "/api/verify" && method === "POST") return verifyPOST(request);
  if (path === "/api/prioritize" && method === "POST") return priorityPOST(request);
  throw new HttpError(400, "Unsupported browser demo action");
}

export async function handleBrowserDemo(request: Request) {
  if (storageMode() !== "browser_demo") return json({ error: "Not found" }, 404);
  let repository: Repository | undefined;
  try {
    checkOrigin(request);
    const user = requireUser(request);
    if (!fixedAccount(user.id)) throw new HttpError(403, "Use one of the five fixed role accounts for this browser demo");
    const input = z.object({ path: z.string().max(1000).regex(/^\/api\/[A-Za-z0-9/?=&_.%+-]+$/), method: z.enum(["GET", "POST", "PATCH", "PUT"]), body: z.string().max(4 * 1024 * 1024).optional(), workspace: z.string().max(3_000_000).nullable() }).parse(await body(request, 4 * 1024 * 1024));
    const snapshot = input.workspace ? decodeWorkspace(input.workspace) : null;
    repository = new Repository(":memory:");
    if (snapshot) repository.restoreWorkspace(snapshot);
    const headers = new Headers(request.headers); headers.delete("content-length");
    const url = new URL(request.url); const target = new URL(input.path, url.origin);
    if (target.origin !== url.origin) throw new HttpError(400, "Invalid browser demo path");
    const inner = new Request(target, { method: input.method, headers, ...(input.method !== "GET" && input.body !== undefined ? { body: input.body } : {}) });
    const response = await repositoryContext.run(repository, () => dispatch(inner));
    const data: unknown = await response.json();
    return json({ status: response.status, data, workspace: encodeWorkspace(repository.exportWorkspace()) });
  } catch (error) { return errorResponse(error); }
  finally { repository?.db.close(); }
}
