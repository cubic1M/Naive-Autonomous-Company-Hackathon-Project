import { NotFoundError } from './errors.js';
import { verificationProfile, type VerificationTier } from './proof/profile.js';
import type { Repo } from './repo.js';

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
  /** The job's verification tier (src/proof/profile.ts), so the job page can show what the worker will need. */
  tier: VerificationTier;
}

/**
 * Can this worker take this job? Cheap gate the job page calls before "Yes": not suspended, worker tier high
 * enough, for a notarization job a notary commission verified (verify_notary) that does not expire before
 * the deadline, and for a tier-2 job (over $150 or any certification) a verified Stripe Identity (verify_identity).
 */
export async function checkEligibility(
  deps: { repo: Pick<Repo, 'getJob' | 'getWorker' | 'getWorkerVerification'> },
  input: { workerId: string; jobId: string },
): Promise<EligibilityResult> {
  const [job, worker] = await Promise.all([deps.repo.getJob(input.jobId), deps.repo.getWorker(input.workerId)]);
  if (!job) throw new NotFoundError('job', input.jobId);
  if (!worker) throw new NotFoundError('worker', input.workerId);
  const profile = verificationProfile(job);

  const reasons: string[] = [];
  if (worker.suspended) reasons.push('worker_suspended');
  if (worker.tier < job.required_tier) reasons.push(`tier_too_low: worker tier ${worker.tier}, job requires ${job.required_tier}`);
  if (job.task_type === 'notarization') {
    const v = await deps.repo.getWorkerVerification(worker.id, 'notary_commission');
    if (!v || v.status !== 'verified') reasons.push(`notary_not_verified: ${v?.status ?? 'no verification on file'}`);
    else if (v.expires_at && v.expires_at.getTime() < job.deadline.getTime()) {
      reasons.push('notary_commission_expires_before_deadline');
    }
  }
  if (profile.identityRequired) {
    const v = await deps.repo.getWorkerVerification(worker.id, 'identity');
    if (!v || v.status !== 'verified') {
      const has = v ? `identity verification is ${v.status}` : 'no identity verification on file';
      reasons.push(`identity_not_verified: tier ${profile.tier} job requires a verified identity; ${has} (start one with verify_identity)`);
    }
  }
  return { eligible: reasons.length === 0, reasons, tier: profile.tier };
}
