import { captureEscrow, type EscrowDeps } from './escrow.js';
import { InvalidStateError } from './errors.js';
import { payWorker, type PayoutDeps, type PayWorkerResult } from './payouts.js';

export type SettleDeps = EscrowDeps & PayoutDeps;

/**
 * Capture the customer's card and pay the worker for an approved job, in one idempotent call.
 * The approval check comes first so money is never captured for an unapproved job.
 * Safe to repeat: captureEscrow and payWorker are each idempotent, so a retry after a partial
 * failure resumes where it stopped. A worker without a payout-ready account yields pending_onboarding.
 */
export async function settleApprovedJob(
  deps: SettleDeps,
  jobId: string,
): Promise<{ chargeId: string | null; payout: PayWorkerResult }> {
  const review = await deps.repo.getLatestProofReviewForJob(jobId);
  if (!review || review.decision !== 'approved') {
    throw new InvalidStateError(`job ${jobId} proof is ${review?.decision ?? 'not reviewed'}; settle requires approved`);
  }
  const { chargeId } = await captureEscrow(deps, jobId);
  const payout = await payWorker(deps, jobId);
  return { chargeId, payout };
}
