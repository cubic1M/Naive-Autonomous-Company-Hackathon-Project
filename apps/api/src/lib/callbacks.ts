import { createHmac } from "node:crypto";
import { sql } from "./db";
import { optional } from "./env";

/** POST the job result to the customer's callback_url (signed with CALLBACK_SIGNING_SECRET). */
export async function notifyCustomer(jobId: string) {
  const [job] = await sql`select id, status, callback_url, worker_pay_usd, fee_usd from jobs where id = ${jobId}`;
  if (!job?.callback_url) return;
  const [proof] = await sql`
    select media, fields, verifier_score from proofs
    where job_id = ${jobId} and status = 'approved' order by created_at desc limit 1`;
  // Cameron's liability model (services/compliance), the same fields get_job returns.
  let liability: { model: string | null; reason: string | null; pricing: string } = { model: null, reason: null, pricing: "standard" };
  try {
    const [l] = await sql`select model, reason, pricing from job_liability where job_id = ${jobId}`;
    if (l) liability = { model: l.model, reason: l.reason, pricing: l.pricing };
  } catch {
    // job_liability is created by migration 0003; before it runs, report the defaults.
  }
  const payload = JSON.stringify({
    job_id: job.id,
    status: job.status,
    proof_package: proof
      ? { media_urls: (proof.media ?? []).map((m: any) => m.url), fields: proof.fields ?? {}, verifier_score: Number(proof.verifier_score) }
      : undefined,
    liability_model: liability.model,
    liability_reason: liability.reason,
    pricing: liability.pricing,
    charge_usd: Math.round((Number(job.worker_pay_usd) + Number(job.fee_usd)) * 100) / 100,
  });
  const secret = optional("CALLBACK_SIGNING_SECRET");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) headers["X-Operis-Signature"] = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  try {
    const res = await fetch(job.callback_url, { method: "POST", headers, body: payload });
    console.log(`[callback] job ${jobId} → ${res.status}`);
  } catch (e) {
    console.error(`[callback] job ${jobId} failed`, e);
  }
}
