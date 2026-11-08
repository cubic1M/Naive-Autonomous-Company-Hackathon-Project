// RFC 7591 dynamic client registration (public clients, PKCE, no secret).
import { sql } from "@/lib/db";
import { json, preflight, token } from "@/lib/oauth";
export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const uris: string[] = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((u: unknown) => typeof u === "string") : [];
  const valid = uris.length > 0 && uris.every((u) => /^https:\/\//.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /^[a-z][a-z0-9+.-]*:\/\//.test(u));
  if (!valid) return json({ error: "invalid_redirect_uri", error_description: "redirect_uris must be https, http://localhost, or an app scheme" }, 400);
  const clientId = token("opc_", 18);
  const name = String(b.client_name ?? "MCP client").slice(0, 120);
  await sql`insert into oauth_clients (client_id, client_name, redirect_uris) values (${clientId}, ${name}, ${sql.json(uris)})`;
  return json({
    client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: name, redirect_uris: uris,
    token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
  }, 201);
}
