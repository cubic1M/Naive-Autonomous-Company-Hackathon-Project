// POST /v1/customers: self-serve API key for another team's agent.
// Body: { "name": "Acme Agent", "contact_email": "ops@acme.dev", "description": "what your agent does" }
// Returns the key ONCE. Limited per IP per hour (SIGNUPS_PER_IP_PER_HOUR, default 60).
import { sql } from "@/lib/db";
import { hashKey, newCustomerKey } from "@/lib/auth";
import { apiBaseUrl } from "@/lib/env";
import { logCall, requestIp, userAgent } from "@/lib/apiCalls";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").trim().slice(0, 120);
  const email = String(b.contact_email ?? "").trim().slice(0, 200);
  if (name.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return Response.json({ error: "send { name, contact_email } (and optionally description)" }, { status: 400 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const [{ n }] = await sql`select count(*)::int as n from customers where signup_ip = ${ip} and created_at > now() - interval '1 hour'`;
  // Venues share one IP (hackathon Wi-Fi), so the per-IP cap is generous; SIGNUPS_PER_IP_PER_HOUR overrides.
  if (n >= Number(process.env.SIGNUPS_PER_IP_PER_HOUR ?? 60))
    return Response.json({ error: "too many sign-ups from this address; try again in a few minutes, or add https://operis.live/mcp as an MCP server and sign in through the browser", retry_after_seconds: 600 }, { status: 429, headers: { "Retry-After": "600" } });
  const key = newCustomerKey();
  const [c] = await sql`
    insert into customers (name, contact_email, description, api_key_hash, signup_ip)
    values (${name}, ${email}, ${String(b.description ?? "").slice(0, 500) || null}, ${hashKey(key)}, ${ip}) returning id`;
  logCall({ customer: { id: c.id, name }, channel: "signup", method: "POST /v1/customers", outcome: "ok", http_status: 201,
            summary: `signed up (${email}) and got an API key`, client: userAgent(req), ip: requestIp(req) });
  return Response.json({
    customer_id: c.id,
    api_key: key,
    note: "Store this key now; it is not shown again.",
    mcp_url: `${apiBaseUrl()}/mcp`,
    auth_header_format: "Authorization: Bearer <api_key>",
    guide: `${apiBaseUrl()}/llms.txt`,
  }, { status: 201 });
}
