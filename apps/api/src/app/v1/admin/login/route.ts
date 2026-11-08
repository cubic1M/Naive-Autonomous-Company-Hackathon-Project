// POST { email, password } → { token, email, expires_at } for allowlisted founders (ADMIN_EMAILS).
import { sql } from "@/lib/db";
import { allowedAdminEmails, issueSession, passwordOk } from "@/lib/adminSession";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { email = "", password = "" } = await req.json().catch(() => ({}));
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const [{ n }] = await sql`select count(*)::int as n from admin_login_attempts where ip = ${ip} and not ok and created_at > now() - interval '15 minutes'`;
  if (n >= 8) return Response.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  const e = String(email).trim().toLowerCase();
  const ok = allowedAdminEmails().includes(e) && passwordOk(String(password));
  await sql`insert into admin_login_attempts (ip, email, ok) values (${ip}, ${e.slice(0, 200)}, ${ok})`;
  if (!ok) return Response.json({ error: "Wrong email or password." }, { status: 401 });
  return Response.json({ email: e, ...issueSession(e) });
}
