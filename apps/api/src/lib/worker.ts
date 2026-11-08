import { sql, TransitionError } from "./db";
import { transition } from "./jobs";

import { verifyLinkToken } from "@/tools/outreach";
import { eligibilityForAccept } from "@services/compliance/index";

const OPEN = ["sent", "dry_run", "opened", "queued"];

export async function outreachByToken(token: string) {
  if (verifyLinkToken(token) === null) return undefined; // signed but tampered or expired
  const [o] = await sql`
    select o.id as outreach_id, o.status as outreach_status, o.worker_id, o.job_id, o.short_code,
           j.title, j.instructions, j.address, j.lat, j.lng, j.deadline, j.worker_pay_usd, j.certification_required,
           j.proof_requirement, j.status as job_status, j.worker_id as assigned_worker_id
    from outreach o join jobs j on j.id = o.job_id where o.token = ${token}`;
  return o as Record<string, any> | undefined;
}

/** First yes wins: the state transition outreach→accepted is atomic, so only one worker can get it. */
export async function acceptJob(outreachId: string): Promise<{ ok: true } | { ok: false; reason: string; reasons?: string[] }> {
  const [o] = await sql`select id, job_id, worker_id from outreach where id = ${outreachId}`;
  if (!o) return { ok: false, reason: "not_found" };
  // Cameron's eligibility gate (services/compliance): the licence a connector job needs (L1 notary, L2 State Bar),
  // tier, suspension and identity. Fails closed if the check itself errors.
  const elig = await eligibilityForAccept(o.worker_id, o.job_id).catch((e) => ({
    eligible: false,
    reasons: [`eligibility_check_failed: ${String(e).slice(0, 120)}`],
  }));
  if (!elig.eligible) return { ok: false, reason: "not_eligible", reasons: elig.reasons };
  try {
    await transition(o.job_id, "accepted", { worker_id: o.worker_id });
  } catch (e) {
    if (e instanceof TransitionError) return { ok: false, reason: "already_taken_or_closed" };
    throw e;
  }
  await sql`update outreach set status = 'accepted' where id = ${o.id}`;
  await sql`update outreach set status = 'closed' where job_id = ${o.job_id} and id <> ${o.id} and status in ${sql(OPEN)}`;
  return { ok: true };
}

export async function declineJob(outreachId: string) {
  await sql`update outreach set status = 'declined' where id = ${outreachId} and status in ${sql(OPEN)}`;
}

/** Most recent open offer for a phone number (for SMS "YES"), optionally matched by code. */
export async function openOutreachForPhone(phone: string, code?: string) {
  const rows = await sql`
    select o.id, o.short_code from outreach o join workers w on w.id = o.worker_id join jobs j on j.id = o.job_id
    where w.phone = ${phone} and o.status in ${sql(OPEN)} and j.status = 'outreach' order by o.created_at desc`;
  if (code) return rows.find((r: any) => r.short_code === code) ?? null;
  return rows.length === 1 ? rows[0] : null; // ambiguous if several open offers: ask for the code
}
