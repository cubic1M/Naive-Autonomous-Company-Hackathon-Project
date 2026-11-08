// Edwin's tools: public customer tools + get_job. Always real.
import type { Tools } from "@contracts/tools";
import type { ToolContext } from "@contracts/runtime";
import { checkSafety } from "@/lib/safety";
import { inServiceArea } from "@/lib/geo";
import { flag } from "@/lib/env";
import * as compliance from "@services/compliance/index";

/** Plain-English meaning of each status, returned by get_job so customer agents know what to do. */
export const STATUS_MEANING: Record<string, string> = {
  requested: "Created but not funded yet: pay the escrow_url to start it.",
  held: "Funded (payment held, not charged). We're finding a person now. Nothing to do; check again in a few minutes.",
  outreach: "Offers sent to nearby verified people; waiting for someone to accept.",
  accepted: "A worker accepted and is doing the task. It can no longer be cancelled.",
  proof_submitted: "The worker uploaded proof; it's being verified.",
  approved: "Proof passed verification; payment is being captured.",
  escalated: "Proof needs a human reviewer; usually decided within the hour.",
  paid: "Done. proof_package has the photo URLs, fields and verifier score; your card was charged.",
  rejected: "Proof failed verification; you are refunded automatically.",
  expired: "The deadline passed without accepted proof; you are refunded automatically.",
  refunded: "Refunded in full.",
  cancelled: "Cancelled; any payment hold was released.",
};
const MIN_JOB_USD = 20;

export async function getJob(input: Tools["get_job"]["in"], ctx: ToolContext): Promise<Tools["get_job"]["out"]> {
  const [j] = await ctx.sql`select * from jobs where id = ${input.job_id}`;
  if (!j) throw new Error(`job ${input.job_id} not found`);
  const out: Tools["get_job"]["out"] = {
    job_id: j.id,
    status: j.status,
    title: j.title,
    location: { address: j.address, lat: j.lat, lng: j.lng },
    deadline: new Date(j.deadline).toISOString(),
    budget_usd: Number(j.budget_usd),
    worker_id: j.worker_id,
  };
  // extra context for our own agents (kept short: Naïve truncates tool output at 8k chars)
  Object.assign(out, { status_meaning: STATUS_MEANING[j.status] ?? "", instructions: j.instructions, proof_requirement: j.proof_requirement, worker_pay_usd: Number(j.worker_pay_usd), fee_usd: Number(j.fee_usd) });
  // Cameron's liability model (services/compliance): who provides the work, and the price breakdown.
  let liability: { model: string | null; reason: string | null; pricing: string } = { model: null, reason: null, pricing: "standard" };
  try {
    const [l] = await ctx.sql`select model, reason, pricing from job_liability where job_id = ${j.id}`;
    if (l) liability = { model: l.model, reason: l.reason, pricing: l.pricing };
  } catch {
    // job_liability is created by migration 0003; before it runs, report the defaults.
  }
  Object.assign(out, {
    liability_model: liability.model,
    liability_reason: liability.reason,
    pricing: liability.pricing,
    charge_usd: Math.round((Number(j.worker_pay_usd) + Number(j.fee_usd)) * 100) / 100,
  });
  if (["approved", "paid"].includes(j.status)) {
    const [p] = await ctx.sql`select media, fields, verifier_score from proofs where job_id = ${j.id} and status = 'approved' order by created_at desc limit 1`;
    if (p) out.proof_package = { media_urls: (p.media ?? []).map((m: any) => m.url), fields: p.fields ?? {}, verifier_score: Number(p.verifier_score) };
  }
  return out;
}

export async function requestHuman(
  input: Tools["request_human"]["in"],
  ctx: ToolContext,
  customerId: string,
  createHold?: (jobId: string) => Promise<{ escrow_url: string }>,
): Promise<Tools["request_human"]["out"]> {
  const reject = (reason: string) => ({ job_id: "", status: "rejected" as const, quote_usd: 0, escrow_url: null, reason,
    next_step: "Not created. Fix the request using the reason, or tell your owner; don't resend the same request." });
  if (input.budget_usd < MIN_JOB_USD) return reject(`Minimum job is $${MIN_JOB_USD}.`);
  if (new Date(input.deadline).getTime() < Date.now() + 15 * 60 * 1000) return reject("Deadline must be at least 15 minutes from now.");
  const remote = input.remote === true;
  if (!remote && !input.location) return reject("On-site jobs need a location (address, lat, lng). For online work, pass remote: true.");
  if (!remote && input.location && !inServiceArea(input.location.lat, input.location.lng))
    return reject("Outside our service area for on-site work (San Francisco, 8 km around the YC office). Online work can pass remote: true.");
  const loc = input.location ?? { address: "Remote", lat: null as any, lng: null as any };
  const safety = checkSafety(input.title, input.instructions);
  if (!safety.ok) return reject(`${safety.reason} (${safety.category})`);

  // usage limits: protect the team's agent budgets while payments run in test mode
  const [{ open, today }] = await ctx.sql`
    select count(*) filter (where status not in ('paid','refunded','cancelled','rejected','expired'))::int as open,
           count(*) filter (where created_at > now() - interval '24 hours')::int as today
    from jobs where customer_id = ${customerId}`;
  if (open >= Number(process.env.MAX_OPEN_JOBS_PER_CUSTOMER ?? 3)) return reject("You have too many open jobs. Wait for one to finish or cancel one.");
  if (today >= Number(process.env.MAX_JOBS_PER_CUSTOMER_PER_DAY ?? 10)) return reject("Daily job limit reached for your key. Try again tomorrow.");
  const [{ all }] = await ctx.sql`select count(*)::int as all from jobs where created_at > now() - interval '24 hours'`;
  if (all >= Number(process.env.MAX_JOBS_PER_DAY ?? 60)) return reject("Operis is at capacity today. Try again later.");

  // Cameron's liability policy prices and tags the job (services/compliance): connector jobs (notary, legal) pay the
  // worker the whole budget plus a platform fee on top; work that needs a licence we can't verify is refused here,
  // before payment. quote_usd is what the card is held for: worker pay + fee.
  let q: compliance.JobQuote;
  try {
    q = compliance.quoteJob({ budgetUsd: input.budget_usd, title: input.title, instructions: input.instructions, certification_required: input.certification_required ?? null });
  } catch (e) {
    return reject((e as Error).message);
  }
  if (q.tags.forced === "refuse") return reject(compliance.refusalReason(q.tags.rules.find((r) => r >= "L3" && r <= "L6") ?? q.tags.rules[0]));
  const feeUsd = q.feeCents / 100;
  const workerPayUsd = q.workerPayCents / 100;
  const chargeUsd = q.chargeCents / 100;
  const [job] = await ctx.sql`
    insert into jobs (customer_id, title, instructions, address, lat, lng, deadline, budget_usd, fee_usd, worker_pay_usd,
                      certification_required, proof_requirement, status, callback_url)
    values (${customerId}, ${input.title}, ${input.instructions}, ${loc.address}, ${loc.lat}, ${loc.lng},
            ${input.deadline}, ${input.budget_usd}, ${feeUsd}, ${workerPayUsd}, ${input.certification_required},
            ${ctx.sql.json({ ...input.proof, geofence_m: remote ? null : input.proof?.geofence_m ?? 150 })}, 'requested', ${input.callback_url ?? null})
    returning id`;
  await compliance.recordIntake(job.id, q);
  const liabilityNote = "Our Compliance agent decides after funding whether Operis is the provider or only the marketplace for this job; get_job shows liability_model.";

  // Payments: Cameron's createHold returns a Stripe Checkout URL; the Stripe webhook moves the job to `held`.
  // Without it (or with MOCK_PAYMENTS), we treat the hold as instant so the loop runs end to end.
  if (createHold && !flag("MOCK_PAYMENTS") && !flag("USE_MOCKS")) {
    const { escrow_url } = await createHold(job.id);
    return { job_id: job.id, status: "requested", quote_usd: chargeUsd, escrow_url,
      next_step: `Payment needed: give escrow_url to your human owner to pay once (the card is held, charged only when proof passes). The job starts as soon as it's paid. ${liabilityNote}` };
  }
  await ctx.ledger(job.id, "hold", chargeUsd, "mock");
  await ctx.transition(job.id, "held");
  return { job_id: job.id, status: "held", quote_usd: chargeUsd, escrow_url: null,
    next_step: `Funded. We're finding a verified person now. Call get_job every 2-5 minutes (or wait for your callback_url); status 'paid' means proof is ready. ${liabilityNote}` };
}

export async function cancelJob(input: Tools["cancel_job"]["in"], ctx: ToolContext, customerId: string): Promise<Tools["cancel_job"]["out"]> {
  const [j] = await ctx.sql`select customer_id from jobs where id = ${input.job_id}`;
  if (!j || j.customer_id !== customerId) throw new Error("job not found");
  await ctx.transition(input.job_id, "cancelled");
  return { job_id: input.job_id, status: "cancelled" };
}
