// Edwin's tools: public customer tools + get_job. Always real.
import type { Tools } from "@contracts/tools";
import type { ToolContext } from "@contracts/runtime";
import { checkSafety } from "@/lib/safety";
import { inServiceArea, isStreetAddress, serviceArea } from "@/lib/geo";
import { flag } from "@/lib/env";
import { unknownPaymentMethodText } from "@/lib/stripe-mode";
import * as compliance from "@services/compliance/index";
import type { CreateHoldOptions, CreateHoldResult } from "@services/payments/index";
import { networkLabel, x402Enabled, x402Offer } from "@/lib/x402";
import { MIN_JOB_PRICE_CENTS } from "@services/money-verification/src/pricing";

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
const MIN_JOB_USD = MIN_JOB_PRICE_CENTS / 100;

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
    certification_required: j.certification_required, // the Compliance agent reads it (agents/prompts/compliance.md)
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

const FINDING = "We're finding a verified person now. Call get_job every 2-5 minutes (or wait for your callback_url); status 'paid' means proof is ready.";

/** Plain words for the reasons createHold falls back to Checkout (Stripe card error codes, and its own invalid_payment_method). */
const CARD_NOT_CHARGED: Record<string, string> = {
  card_declined: "the card was declined",
  expired_card: "the card has expired",
  incorrect_cvc: "the card's security code was refused",
  processing_error: "the card network had an error; trying again later may work",
  authentication_required: "the card's bank wants the cardholder to confirm this payment, which needs a person",
};

/** next_step while a human still has to pay escrow_url: why the card was not charged, if one was tried, and how to skip the link. */
function paymentNeeded(fallbackReason?: string): string {
  const pay = "have your human owner pay escrow_url once (the card is held, charged only when proof passes); the job starts as soon as it's paid";
  if (!fallbackReason) return `Payment needed: ${pay}. To skip the link next time, call setup_payment once and have your owner save a card.`;
  const why =
    fallbackReason === "invalid_payment_method"
      ? unknownPaymentMethodText()
      : CARD_NOT_CHARGED[fallbackReason] ?? `the card could not be charged (${fallbackReason})`;
  return `Your card was not charged: ${why}. To fund this job, ${pay}. Or cancel_job it, save another card with setup_payment and request again.`;
}

/**
 * A card authorized in this call funds the job: move it to held now, which wakes Compliance as for a job funded through
 * the webhook. payment_intent.amount_capturable_updated can reach the webhook first and move it there itself; then the
 * job is already held and that is not an error.
 */
export async function markFunded(ctx: ToolContext, jobId: string): Promise<void> {
  try {
    await ctx.transition(jobId, "held");
  } catch (e) {
    const [j] = await ctx.sql`select status from jobs where id = ${jobId}`;
    if (j?.status !== "held") throw e;
  }
}

export async function requestHuman(
  input: Tools["request_human"]["in"],
  ctx: ToolContext,
  customerId: string,
  createHold?: (jobId: string, opts?: CreateHoldOptions) => Promise<CreateHoldResult>,
): Promise<Tools["request_human"]["out"]> {
  const reject = (reason: string) => ({ job_id: "", status: "rejected" as const, quote_usd: 0, escrow_url: null, reason,
    next_step: "Not created. Fix the request using the reason, or tell your owner; don't resend the same request." });
  if (input.budget_usd < MIN_JOB_USD) return reject(`Minimum job is $${MIN_JOB_USD}.`);
  if (new Date(input.deadline).getTime() < Date.now() + 15 * 60 * 1000) return reject("Deadline must be at least 15 minutes from now.");
  const remote = input.remote === true;
  if (!remote && !input.location) return reject("On-site jobs need a location (address, lat, lng). For online work, pass remote: true.");
  const area = serviceArea();
  if (!remote && input.location && !inServiceArea(input.location.lat, input.location.lng))
    return reject(`Outside our service area for on-site work (San Francisco, within ${area.radiusM / 1000} km of ${area.lat}, ${area.lng}). Online work can pass remote: true.`);
  if (!remote && input.location && input.location.lat.toFixed(4) === area.lat.toFixed(4) && input.location.lng.toFixed(4) === area.lng.toFixed(4))
    return reject(`${area.lat}, ${area.lng} is the centre of our service area, not the job's spot. Send the exact lat/lng of the street address, e.g. "1 Ferry Building, San Francisco, CA 94111" at 37.7955, -122.3935. Proof is checked against that pin.`);
  if (!remote && input.location && !isStreetAddress(input.location.address))
    return reject(`"${input.location.address.slice(0, 80)}" is not a street address. On-site jobs need the address a worker can walk to (number and street, e.g. "1 Ferry Building, San Francisco, CA 94111", or an intersection, e.g. "Haight St & Ashbury St") and that spot's exact lat/lng. Proof is checked against that pin.`);
  const loc = input.location ?? { address: "Remote", lat: null as any, lng: null as any };
  const safety = checkSafety(input.title, input.instructions);
  if (!safety.ok) return reject(`${safety.reason} (${safety.category})`);

  // usage limits: cap how many jobs one key (and Operis overall) can open; in live mode they also bound real card holds
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
            ${ctx.sql.json({ ...input.proof, geofence_m: remote ? null : input.proof?.geofence_m ?? null })}, 'requested', ${input.callback_url ?? null})
    returning id`;
  await compliance.recordIntake(job.id, q);
  const liabilityNote = "Our Compliance agent decides after funding whether Operis is the provider or only the marketplace for this job; get_job shows liability_model.";

  // Payments: Cameron's createHold holds quote_usd on the card in payment.payment_method, else on the customer's saved
  // card, in this call: funded, so the job moves to `held` now. Without a card, or when the card is refused
  // (fallback_reason), it returns a Stripe Checkout URL and the Stripe webhook moves the job to `held` once it is paid.
  // next_step is written here, not taken from createHold, because it names this server's tools (setup_payment, cancel_job).
  // Without createHold (or with MOCK_PAYMENTS), we treat the hold as instant so the loop runs end to end.
  if (createHold && !flag("MOCK_PAYMENTS") && !flag("USE_MOCKS")) {
    const hold = await createHold(job.id, { paymentMethod: input.payment?.payment_method });
    if (hold.funded) {
      await markFunded(ctx, job.id);
      return { job_id: job.id, status: "held", quote_usd: chargeUsd, escrow_url: null,
        next_step: `Funded: your card is held, charged only when proof passes. ${FINDING} ${liabilityNote}` };
    }
    // x402 (when on): an agent with a USDC wallet funds the job itself, no human (Naïve wallet.pay, Coinbase agent wallets).
    const x402 = x402Enabled() ? x402Offer(job.id, chargeUsd) : undefined;
    return { job_id: job.id, status: "requested", quote_usd: chargeUsd, escrow_url: hold.escrow_url,
      ...(hold.fallback_reason ? { fallback_reason: hold.fallback_reason } : {}),
      ...(x402 ? { x402 } : {}),
      next_step: x402
        ? `If you have an x402 wallet, fund it yourself now: pay x402.url ($${chargeUsd} USDC on ${networkLabel(x402.network)}; on Naïve call wallet.pay with that url), then the job is held. Otherwise: ${paymentNeeded(hold.fallback_reason)} ${liabilityNote}`
        : `${paymentNeeded(hold.fallback_reason)} ${liabilityNote}` };
  }
  await ctx.ledger(job.id, "hold", chargeUsd, "mock");
  await ctx.transition(job.id, "held");
  return { job_id: job.id, status: "held", quote_usd: chargeUsd, escrow_url: null,
    next_step: `Funded. ${FINDING} ${liabilityNote}` };
}

/**
 * setup_payment and POST /v1/customers/payment-setup: Cameron's createPaymentSetupLink, a Stripe Checkout page (setup
 * mode) where the customer's human owner saves a card once. The Stripe webhook stores it, and from then on createHold
 * funds every request_human from it with no link.
 */
export async function setupPayment(
  customerId: string,
  createPaymentSetupLink?: (customerId: string) => Promise<{ url: string }>,
): Promise<Tools["setup_payment"]["out"]> {
  if (!createPaymentSetupLink || flag("MOCK_PAYMENTS") || flag("USE_MOCKS"))
    return { url: null, next_step: "No card to save on this server: when request_human needs payment, it answers with an escrow_url." };
  const { url } = await createPaymentSetupLink(customerId);
  return { url, next_step: "Give url to your human owner to open once and save a card; nothing is charged now. From then on request_human funds each job from that card in the call: status held, escrow_url null. The link works for 24 hours; call setup_payment again for a new one or to replace the card." };
}

export async function cancelJob(input: Tools["cancel_job"]["in"], ctx: ToolContext, customerId: string): Promise<Tools["cancel_job"]["out"]> {
  const [j] = await ctx.sql`select customer_id from jobs where id = ${input.job_id}`;
  if (!j || j.customer_id !== customerId) throw new Error("job not found");
  await ctx.transition(input.job_id, "cancelled");
  return { job_id: input.job_id, status: "cancelled" };
}
