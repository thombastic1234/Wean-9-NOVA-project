import { z } from "zod";

export const aiDiagnosticSchema = z.object({
  code: z.enum(["missing_key", "invalid_configuration", "invalid_key", "insufficient_credits", "permission_denied", "rate_limited", "invalid_request", "model_unavailable", "provider_unavailable", "network_error", "timeout", "invalid_response", "truncated_response"]),
  message: z.string().max(240), upstreamStatus: z.number().int().min(100).max(599).optional(),
});
export type AiDiagnostic = z.infer<typeof aiDiagnosticSchema>;
const messages: Record<AiDiagnostic["code"], string> = {
  missing_key: "No server OpenRouter API key is configured. Set OPENROUTER_API_KEY in Vercel and redeploy.",
  invalid_configuration: "The server OpenRouter key contains invalid characters. Enter only the API key in OPENROUTER_API_KEY and redeploy.",
  invalid_key: "OpenRouter rejected the server API key. Check OPENROUTER_API_KEY in Vercel and redeploy with a valid key.",
  insufficient_credits: "OpenRouter reports insufficient credits or an exhausted key limit. Check the OpenRouter account's billing and key limits.",
  permission_denied: "OpenRouter denied this request. Check the key's model permissions, account limits, and provider policy.",
  rate_limited: "OpenRouter is rate limiting requests. Wait before trying again; the fallback remains available.",
  invalid_request: "OpenRouter rejected the request parameters or structured-output schema. Check the server diagnostic in Vercel logs.",
  model_unavailable: "OpenRouter could not find the configured model or a compatible provider. Check model access and provider availability.",
  provider_unavailable: "The OpenRouter provider is temporarily unavailable. Retry later; the fallback remains available.",
  network_error: "The server could not connect to OpenRouter. Check server network access and retry later.",
  timeout: "The OpenRouter request timed out. Retry later; the fallback remains available.",
  invalid_response: "OpenRouter returned an invalid or unsupported response. The result was rejected; the fallback remains available.",
  truncated_response: "OpenRouter stopped before completing the JSON response because its output limit was reached. No partial result was accepted.",
};
export function aiDiagnostic(code: AiDiagnostic["code"], upstreamStatus?: number): AiDiagnostic {
  return { code, message: messages[code], ...(upstreamStatus === undefined ? {} : { upstreamStatus }) };
}
