// Edwin's tools: public customer tools + get_job. Always real.
import type { Tools } from "@contracts/tools";
import type { ToolContext } from "@contracts/runtime";
import { checkSafety } from "@/lib/safety";
import { inServiceArea } from "@/lib/geo";
import { flag } from "@/lib/env";

const FEE_RATE = 0.25;
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
  Object.assign(out, { instructions: j.instructions, proof_requirement: j.proof_requirement, worker_pay_usd: Number(j.worker_pay_usd), fee_usd: Number(j.fee_usd) });
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
  const reject = (reason: string) => ({ job_id: "", status: "rejected" as const, quote_usd: 0, escrow_url: null, reason });
  if (input.budget_usd < MIN_JOB_USD) return reject(`Minimum job is $${MIN_JOB_USD}.`);
  if (new Date(input.deadline).getTime() < Date.now() + 15 * 60 * 1000) return reject("Deadline must be at least 15 minutes from now.");
  if (!inServiceArea(input.location.lat, input.location.lng)) return reject("Outside our service area (San Francisco, 8 km around the YC office).");
  const safety = checkSafety(input.title, input.instructions);
  if (!safety.ok) return reject(`${safety.reason} (${safety.category})`);

  const fee = Math.round(input.budget_usd * FEE_RATE * 100) / 100;
  const [job] = await ctx.sql`
    insert into jobs (customer_id, title, instructions, address, lat, lng, deadline, budget_usd, fee_usd, worker_pay_usd,
                      certification_required, proof_requirement, status, callback_url)
    values (${customerId}, ${input.title}, ${input.instructions}, ${input.location.address}, ${input.location.lat}, ${input.location.lng},
            ${input.deadline}, ${input.budget_usd}, ${fee}, ${input.budget_usd - fee}, ${input.certification_required},
            ${ctx.sql.json(input.proof)}, 'requested', ${input.callback_url ?? null})
    returning id`;

  // Payments: Cameron's createHold returns a Stripe Checkout URL; the Stripe webhook moves the job to `held`.
  // Without it (or with MOCK_PAYMENTS), we treat the hold as instant so the loop runs end to end.
  if (createHold && !flag("MOCK_PAYMENTS") && !flag("USE_MOCKS")) {
    const { escrow_url } = await createHold(job.id);
    return { job_id: job.id, status: "requested", quote_usd: input.budget_usd, escrow_url };
  }
  await ctx.ledger(job.id, "hold", input.budget_usd, "mock");
  await ctx.transition(job.id, "held");
  return { job_id: job.id, status: "requested", quote_usd: input.budget_usd, escrow_url: null };
}

export async function cancelJob(input: Tools["cancel_job"]["in"], ctx: ToolContext, customerId: string): Promise<Tools["cancel_job"]["out"]> {
  const [j] = await ctx.sql`select customer_id from jobs where id = ${input.job_id}`;
  if (!j || j.customer_id !== customerId) throw new Error("job not found");
  await ctx.transition(input.job_id, "cancelled");
  return { job_id: input.job_id, status: "cancelled" };
}
