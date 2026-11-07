import { sql, TransitionError } from "./db";
import { transition } from "./jobs";

export async function outreachByToken(token: string) {
  const [o] = await sql`
    select o.id as outreach_id, o.status as outreach_status, o.worker_id, o.job_id, o.short_code,
           j.title, j.instructions, j.address, j.lat, j.lng, j.deadline, j.worker_pay_usd, j.certification_required,
           j.proof_requirement, j.status as job_status, j.worker_id as assigned_worker_id
    from outreach o join jobs j on j.id = o.job_id where o.token = ${token}`;
  return o as Record<string, any> | undefined;
}

/** First yes wins: the state transition outreach→accepted is atomic, so only one worker can get it. */
export async function acceptJob(outreachId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [o] = await sql`select id, job_id, worker_id from outreach where id = ${outreachId}`;
  if (!o) return { ok: false, reason: "not_found" };
  try {
    await transition(o.job_id, "accepted", { worker_id: o.worker_id });
  } catch (e) {
    if (e instanceof TransitionError) return { ok: false, reason: "already_taken_or_closed" };
    throw e;
  }
  await sql`update outreach set status = 'accepted' where id = ${o.id}`;
  await sql`update outreach set status = 'closed' where job_id = ${o.job_id} and id <> ${o.id} and status in ('sent','opened')`;
  return { ok: true };
}

export async function declineJob(outreachId: string) {
  await sql`update outreach set status = 'declined' where id = ${outreachId} and status in ('sent','opened')`;
}
