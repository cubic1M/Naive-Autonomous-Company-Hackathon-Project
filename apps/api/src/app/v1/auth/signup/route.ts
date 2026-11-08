// POST {name, email, phone, password} → creates a worker account, signs in (cookie) → {ok, user}.
import { hashPassword, json, signedIn, weakPassword, workerFor } from "@/lib/accounts";
import { sql } from "@/lib/db";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").trim().slice(0, 120);
  const email = String(b.email ?? "").trim().toLowerCase().slice(0, 200);
  const phone = String(b.phone ?? "").replace(/[^\d+]/g, "").slice(0, 20) || null;
  if (name.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: "invalid_fields" }, 400);
  if (weakPassword(b.password)) return json({ ok: false, error: "weak_password" }, 400);
  const [taken] = await sql`select 1 from worker_accounts where lower(email) = ${email}`;
  if (taken) return json({ ok: false, error: "email_taken" }, 409);
  if (phone) {
    const [p] = await sql`select 1 from worker_accounts where phone = ${phone}`;
    if (p) return json({ ok: false, error: "phone_taken" }, 409);
  }
  const workerId = await workerFor(name, email, phone);
  const [a] = await sql`insert into worker_accounts (worker_id, name, email, phone, password_hash)
                        values (${workerId}, ${name}, ${email}, ${phone}, ${hashPassword(b.password)}) returning *`;
  return signedIn(a, true, 201, "signup");
}
