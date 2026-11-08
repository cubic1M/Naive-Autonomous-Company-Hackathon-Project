// POST token endpoint (form or JSON): authorization_code (PKCE) and refresh_token grants.
// The access token is an Operis customer key (opk_…) stored in customer_keys, so /mcp accepts it as-is.
import { sql } from "@/lib/db";
import { hashKey } from "@/lib/auth";
import { json, pkceOk, preflight, sha256, token } from "@/lib/oauth";
export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

async function readBody(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return (await req.json().catch(() => ({}))) as Record<string, string>;
  return Object.fromEntries(new URLSearchParams(await req.text()));
}
const err = (error: string, error_description: string, status = 400) => json({ error, error_description }, status);

async function issue(customerId: string, clientId: string) {
  const [cl] = await sql`select client_name from oauth_clients where client_id = ${clientId}`;
  const access = token("opk_", 24), refresh = token("opr_", 32);
  await sql`insert into customer_keys (customer_id, key_hash, label) values (${customerId}, ${hashKey(access)}, ${`oauth:${cl?.client_name ?? clientId}`})`;
  await sql`insert into oauth_refresh_tokens (token_hash, client_id, customer_id) values (${sha256(refresh)}, ${clientId}, ${customerId})`;
  return json({ access_token: access, token_type: "Bearer", refresh_token: refresh, scope: "operis" });
}

export async function POST(req: Request) {
  const b = await readBody(req);
  if (b.grant_type === "authorization_code") {
    const [c] = await sql`
      update oauth_codes set used = true
      where code_hash = ${sha256(b.code ?? "")} and not used and expires_at > now()
      returning client_id, customer_id, redirect_uri, code_challenge`;
    if (!c) return err("invalid_grant", "code is invalid, used or expired");
    if (b.client_id && b.client_id !== c.client_id) return err("invalid_grant", "client_id mismatch");
    if (b.redirect_uri && b.redirect_uri !== c.redirect_uri) return err("invalid_grant", "redirect_uri mismatch");
    if (!pkceOk(b.code_verifier ?? "", c.code_challenge)) return err("invalid_grant", "PKCE verification failed");
    return issue(c.customer_id, c.client_id);
  }
  if (b.grant_type === "refresh_token") {
    const [r] = await sql`select client_id, customer_id from oauth_refresh_tokens where token_hash = ${sha256(b.refresh_token ?? "")} and not revoked`;
    if (!r) return err("invalid_grant", "refresh token is invalid");
    await sql`update oauth_refresh_tokens set revoked = true where token_hash = ${sha256(b.refresh_token ?? "")}`;
    return issue(r.customer_id, r.client_id);
  }
  return err("unsupported_grant_type", "use authorization_code or refresh_token");
}
