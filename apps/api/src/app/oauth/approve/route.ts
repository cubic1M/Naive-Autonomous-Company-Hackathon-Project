// POST from the consent page. Either { name, contact_email, description } (new company, self-serve) or
// { api_key } (existing company), plus the OAuth params. Issues a one-time code and returns the redirect.
import { sql } from "@/lib/db";
import { hashKey } from "@/lib/auth";
import { json, sha256, token } from "@/lib/oauth";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const [c] = await sql`select redirect_uris from oauth_clients where client_id = ${String(b.client_id ?? "")}`;
  if (!c || !(c.redirect_uris as string[]).includes(b.redirect_uri)) return json({ error: "invalid_client_or_redirect" }, 400);
  if (!b.code_challenge) return json({ error: "missing_code_challenge" }, 400);

  let customerId: string | null = null;
  if (b.api_key) {
    const k = String(b.api_key).trim();
    const [byMain] = await sql`select id from customers where api_key_hash = ${hashKey(k)}`;
    const [byExtra] = byMain ? [byMain] : await sql`select customer_id as id from customer_keys where key_hash = ${hashKey(k)} and not revoked`;
    if (!byExtra) return json({ error: "That key wasn't recognised." }, 401);
    customerId = byExtra.id;
  } else {
    const name = String(b.name ?? "").trim().slice(0, 120), email = String(b.contact_email ?? "").trim().slice(0, 200);
    if (name.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a company name and a valid email." }, 400);
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const [{ n }] = await sql`select count(*)::int as n from customers where signup_ip = ${ip} and created_at > now() - interval '1 hour'`;
    if (n >= 5) return json({ error: "Too many sign-ups from this address; try again later." }, 429);
    // The company's first key is never shown here; the connected app gets its own key via /oauth/token.
    const [row] = await sql`insert into customers (name, contact_email, description, api_key_hash, signup_ip)
      values (${name}, ${email}, ${String(b.description ?? "").slice(0, 500) || null}, ${hashKey(token("opk_", 24))}, ${ip}) returning id`;
    customerId = row.id;
  }

  const code = token("", 32);
  await sql`insert into oauth_codes (code_hash, client_id, customer_id, redirect_uri, code_challenge, scope, resource, expires_at)
    values (${sha256(code)}, ${b.client_id}, ${customerId}, ${b.redirect_uri}, ${b.code_challenge}, ${b.scope ?? null}, ${b.resource ?? null}, now() + interval '10 minutes')`;
  const u = new URL(b.redirect_uri);
  u.searchParams.set("code", code);
  if (b.state) u.searchParams.set("state", b.state);
  return json({ redirect: u.toString() });
}
