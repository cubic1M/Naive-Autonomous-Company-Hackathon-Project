import { createHmac, timingSafeEqual } from "node:crypto";
import { optional } from "./env";

const BASE = "https://api.mobilerun.ai/v1";

/** POST /numbers/phones/{id}/messages: queue an SMS from our Mobilerun number. */
export async function mobilerunSend(to: string, body: string, idempotencyKey?: string) {
  const key = optional("MOBILERUN_API_KEY");
  const phoneId = optional("MOBILERUN_PHONE_ID");
  if (!key || !phoneId) return { ok: false as const, error: "mobilerun_not_configured" };
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey.slice(0, 255);
  const res = await fetch(`${BASE}/numbers/phones/${phoneId}/messages`, { method: "POST", headers, body: JSON.stringify({ to, body }) });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false as const, error: `mobilerun_${res.status}:${json?.error?.code ?? json?.code ?? ""}` };
  return { ok: true as const, id: json?.data?.id ?? json?.id };
}

/**
 * Verify X-Mobilerun-Signature: "sha256=<hex>" HMAC-SHA256 over "{timestamp}.{rawBody}",
 * timestamp from X-Mobilerun-Timestamp (milliseconds). Rejects requests older than 5 minutes.
 */
export function verifyMobilerunSignature(rawBody: string, timestamp: string | null, signature: string | null): boolean {
  const secret = optional("MOBILERUN_WEBHOOK_SECRET");
  if (!secret || !timestamp || !signature) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
