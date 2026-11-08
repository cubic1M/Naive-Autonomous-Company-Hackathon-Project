/**
 * Redeeming a free first job (spec section 11). The CEO calls redeem_promo for a paid job; it checks the grant,
 * reserves it, and returns the exact operis.refund call to make. Money code is not touched: the refund itself is
 * Cameron's existing tool.
 */
import type { GrowthDeps } from './deps.js';
import { grantKeyFor } from './promo.js';
import type { Grant, JobWithCustomer } from './types.js';

export const PROMO_REASON = 'Free first job (Operis Sales offer)';
const cents = (usd: number) => Math.round(usd * 100);

export interface PromoDue {
  job_id: string;
  customer: string;
  refund_cents: number;
}

export type RedeemResult =
  | { eligible: true; refund: { job_id: string; amount_cents: number; request_id: string; reason: string } }
  | { eligible: false; reason: string };

/** Null when grant `g` covers paid job `j`; otherwise why not. */
async function whyNot(deps: GrowthDeps, g: Grant, j: JobWithCustomer): Promise<string | null> {
  if (g.redeemed_job_id && g.redeemed_job_id !== j.job_id) return 'grant_already_redeemed';
  if (j.created_at < g.created_at) return 'job_predates_offer';
  if (j.created_at > g.expires_at) return 'offer_expired';
  if (!j.customer_id) return 'job_has_no_customer';
  if ((await deps.repo.countPaidJobsBefore(j.customer_id, j.created_at, j.job_id)) > 0) return 'not_first_paid_job';
  return null;
}

/** Paid jobs an unredeemed grant covers: the CEO's to-do list in the daily report. */
export async function promosDue(deps: GrowthDeps): Promise<PromoDue[]> {
  const open = new Map((await deps.repo.listGrants()).filter((g) => !g.redeemed_job_id).map((g) => [g.grant_key, g]));
  if (open.size === 0) return [];
  const due: PromoDue[] = [];
  for (const j of await deps.repo.listPaidJobs()) {
    const g = j.contact_email ? open.get(grantKeyFor(j.contact_email)) : undefined;
    if (!g || (await whyNot(deps, g, j))) continue;
    due.push({ job_id: j.job_id, customer: j.customer_name ?? j.contact_email ?? 'unknown', refund_cents: Math.min(g.cap_cents, cents(j.budget_usd)) });
  }
  return due;
}

const instruction = (g: Grant, jobId: string): RedeemResult => ({
  eligible: true,
  refund: { job_id: jobId, amount_cents: g.refund_cents ?? 0, request_id: `promo:${g.id}`, reason: PROMO_REASON },
});

export async function redeemPromo(deps: GrowthDeps, jobId: string): Promise<RedeemResult> {
  const reserved = await deps.repo.getGrantByJob(jobId);
  if (reserved) return instruction(reserved, jobId); // a retry gets the same call; refund's request_id makes it idempotent
  const j = await deps.repo.getJobWithCustomer(jobId);
  if (!j) return { eligible: false, reason: 'job_not_found' };
  if (j.status !== 'paid') return { eligible: false, reason: `job_not_paid: status is ${j.status}` };
  if (!j.contact_email) return { eligible: false, reason: 'customer_has_no_contact_email' };
  const g = await deps.repo.getGrantByKey(grantKeyFor(j.contact_email));
  if (!g) return { eligible: false, reason: 'no_grant_for_customer' };
  const why = await whyNot(deps, g, j);
  if (why) return { eligible: false, reason: why };
  const refundCents = Math.min(g.cap_cents, cents(j.budget_usd));
  if (refundCents <= 0) return { eligible: false, reason: 'nothing_to_refund' };
  const after = await deps.repo.reserveGrant(g.id, jobId, refundCents, deps.now());
  if (!after || after.redeemed_job_id !== jobId) return { eligible: false, reason: 'grant_already_redeemed' };
  return instruction(after, jobId);
}
