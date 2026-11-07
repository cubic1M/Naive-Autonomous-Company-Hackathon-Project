import { createHmac } from "node:crypto";
import { sql } from "./db";
import { optional } from "./env";

/** POST the job result to the customer's callback_url (signed with CALLBACK_SIGNING_SECRET). */
export async function notifyCustomer(jobId: string) {
  const [job] = await sql`select id, status, callback_url from jobs where id = ${jobId}`;
  if (!job?.callback_url) return;
  const [proof] = await sql`
    select media, fields, verifier_score from proofs
    where job_id = ${jobId} and status = 'approved' order by created_at desc limit 1`;
  const payload = JSON.stringify({
    job_id: job.id,
    status: job.status,
    proof_package: proof
      ? { media_urls: (proof.media ?? []).map((m: any) => m.url), fields: proof.fields ?? {}, verifier_score: Number(proof.verifier_score) }
      : undefined,
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
