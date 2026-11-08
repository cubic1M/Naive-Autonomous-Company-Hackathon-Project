// POST {email, password, remember?} → cookie · {ok, user}; 401 bad_credentials.
import { checkPassword, json, signedIn } from "@/lib/accounts";
import { sql } from "@/lib/db";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const email = String(b.email ?? "").trim().toLowerCase();
  const [a] = email ? await sql`select * from worker_accounts where lower(email) = ${email}` : [];
  if (!a || !checkPassword(String(b.password ?? ""), a.password_hash)) return json({ ok: false, error: "bad_credentials" }, 401);
  return signedIn(a, b.remember !== false);
}
