// GET: proofs waiting for a founder decision (job escalated by the Verifier), plus headline numbers.
import { sql } from "@/lib/db";
import { authAdmin } from "@/lib/auth";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authAdmin(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const items = await sql`
    select j.id as job_id, j.title, j.instructions, j.address, j.lat, j.lng, j.deadline, j.budget_usd, j.proof_requirement,
           p.id as proof_id, p.media, p.gps_lat, p.gps_lng, p.captured_at, p.verifier_score, p.verifier_notes, p.created_at as proof_at,
           w.name as worker_name, w.email as worker_email
    from jobs j
    join lateral (select * from proofs where job_id = j.id order by created_at desc limit 1) p on true
    left join workers w on w.id = j.worker_id
    where j.status = 'escalated'
    order by p.created_at asc`;
  const [counts] = await sql`
    select count(*) filter (where status not in ('paid','refunded','cancelled','rejected','expired'))::int as open,
           count(*) filter (where status = 'paid')::int as paid,
           count(*) filter (where status = 'escalated')::int as escalated
    from jobs`;
  return Response.json({ counts, items });
}
