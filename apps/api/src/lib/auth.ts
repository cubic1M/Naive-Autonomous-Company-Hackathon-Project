import { createHash, randomBytes } from "node:crypto";
import { sql } from "./db";
import { optional } from "./env";

export const hashKey = (k: string) => createHash("sha256").update(k).digest("hex");
export const newCustomerKey = () => "opk_" + randomBytes(24).toString("base64url");

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  return h?.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : null;
}

/** Customer agents: Authorization: Bearer opk_… (hashed in customers.api_key_hash). */
export async function authCustomer(req: Request): Promise<{ id: string; name: string } | null> {
  const key = bearer(req);
  if (!key) return null;
  const [c] = await sql`select id, name from customers where api_key_hash = ${hashKey(key)}`;
  return (c as any) ?? null;
}

/**
 * Our own Naïve agents. Accepts the internal key as a Bearer header (Naïve vault static_bearer)
 * or, as a fallback if Naïve can't inject headers, as ?key= on the MCP URL.
 */
export function authInternal(req: Request): boolean {
  const expected = optional("INTERNAL_MCP_KEY");
  if (!expected) return false;
  const got = bearer(req) ?? new URL(req.url).searchParams.get("key");
  return got === expected;
}
