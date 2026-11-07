import { z } from "zod";
import { aiDiagnostic, type AiDiagnostic } from "../lib/aiDiagnostics";

export class OpenRouterError extends Error {
  diagnostic: AiDiagnostic;
  constructor(code: AiDiagnostic["code"], status?: number) { const diagnostic = aiDiagnostic(code, status); super(diagnostic.message); this.diagnostic = diagnostic; }
}
export function normalizeApiKey(value?: string): string {
  let key = value?.trim() ?? "";
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1).trim();
  key = key.replace(/^Bearer\s+/i, "").trim();
  if (!key) throw new OpenRouterError("missing_key");
  if (/\s|[\x00-\x1f\x7f]/.test(key)) throw new OpenRouterError("invalid_configuration");
  return key;
}
function httpFailure(status: number): OpenRouterError {
  const code = status === 401 ? "invalid_key" : status === 402 ? "insufficient_credits" : status === 403 ? "permission_denied" : status === 429 ? "rate_limited" : status === 404 ? "model_unavailable" : status === 408 || status === 504 ? "timeout" : status >= 400 && status < 500 ? "invalid_request" : "provider_unavailable";
  return new OpenRouterError(code, status);
}
async function providerJson(response: Response): Promise<unknown> {
  let value: unknown;
  try { value = await response.json(); }
  catch { throw response.ok ? new OpenRouterError("invalid_response") : httpFailure(response.status); }
  if (!response.ok) throw httpFailure(response.status);
  // OpenRouter can report an error in an HTTP 200 body after a provider accepted it.
  if (value && typeof value === "object" && "error" in value && value.error) {
    const error = value.error;
    const code = typeof error === "object" && "code" in error ? Number(error.code) : NaN;
    throw httpFailure(Number.isInteger(code) && code >= 400 && code <= 599 ? code : 502);
  }
  return value;
}
export function reportAiFailure(feature: "priority" | "vision" | "connection", error: unknown): AiDiagnostic {
  const diagnostic = error instanceof OpenRouterError ? error.diagnostic : aiDiagnostic("invalid_response");
  // Static messages and typed status only. Never log raw bodies, prompts, images,
  // exception text, authorization headers, or keys supplied by a provider.
  console.warn("PassCheck AI failure", { feature, ...diagnostic });
  return diagnostic;
}
export async function openRouterCompletion(payload: unknown, apiKey: string | undefined, signal: AbortSignal): Promise<string> {
  const key = normalizeApiKey(apiKey);
  let response: Response;
  try { response = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal }); }
  catch { throw new OpenRouterError(signal.aborted ? "timeout" : "network_error"); }
  const value = await providerJson(response);
  const parsed = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable().optional() }), finish_reason: z.string().nullable() })).min(1) }).safeParse(value);
  if (!parsed.success) throw new OpenRouterError("invalid_response");
  const choice = parsed.data.choices[0];
  if (choice.finish_reason === "length") throw new OpenRouterError("truncated_response");
  if (choice.finish_reason === "content_filter") throw new OpenRouterError("permission_denied");
  if (choice.finish_reason !== "stop" || !choice.message.content?.trim()) throw new OpenRouterError("invalid_response");
  return choice.message.content;
}
export async function checkOpenRouterKey(apiKey?: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  try {
    const key = normalizeApiKey(apiKey);
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new OpenRouterError("timeout")); }, 8_000); });
    const check = (async () => {
      let response: Response;
      try { response = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: controller.signal }); }
      catch { throw new OpenRouterError(controller.signal.aborted ? "timeout" : "network_error"); }
      const parsed = z.object({ data: z.object({ limit_remaining: z.number().nullable().optional() }) }).safeParse(await providerJson(response));
      if (!parsed.success) throw new OpenRouterError("invalid_response");
      if (parsed.data.data.limit_remaining !== null && parsed.data.data.limit_remaining !== undefined && parsed.data.data.limit_remaining <= 0) throw new OpenRouterError("insufficient_credits");
      return { ok: true as const, message: "OpenRouter accepted the server API key. Model availability and photo recognition still require a successful request." };
    })();
    return await Promise.race([check, deadline]);
  } catch (error) { return { ok: false as const, diagnostic: reportAiFailure("connection", error) }; }
  finally { clearTimeout(timer); }
}
