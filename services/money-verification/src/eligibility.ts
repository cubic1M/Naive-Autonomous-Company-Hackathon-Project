import type { Env } from './env.js';
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
 * Under IDENTITY_GATE=log the identity reason is still listed (the job page reads it to offer the identity step)
 * but marked not enforced, and it does not make the worker ineligible.
 */
export async function checkEligibility(
  deps: { repo: Pick<Repo, 'getJob' | 'getWorker' | 'getWorkerVerification' | 'getJobLiability'>; env?: Pick<Env, 'IDENTITY_GATE'> },
  input: { workerId: string; jobId: string },
): Promise<EligibilityResult> {
  const [job, worker] = await Promise.all([deps.repo.getJob(input.jobId), deps.repo.getWorker(input.workerId)]);
  if (!job) throw new NotFoundError('job', input.jobId);
  if (!worker) throw new NotFoundError('worker', input.workerId);
  const profile = verificationProfile(job, { identityGate: deps.env?.IDENTITY_GATE });

  const reasons: string[] = [];
  if (worker.suspended) reasons.push('worker_suspended');
  if (worker.tier < job.required_tier) reasons.push(`tier_too_low: worker tier ${worker.tier}, job requires ${job.required_tier}`);
  // Licences the job's liability tags require (src/liability/policy.ts): L1 a notary commission, also when task_type
  // is not notarization; L2 an active State Bar licence (verify_attorney). No intake row means no tags.
  const rules = (await deps.repo.getJobLiability(job.id))?.tags.rules ?? [];
  const licence = async (kind: 'notary_commission' | 'attorney_license', label: 'notary' | 'attorney', missing: string) => {
    const v = await deps.repo.getWorkerVerification(worker.id, kind);
    if (!v || v.status !== 'verified') reasons.push(`${label}_not_verified: ${v?.status ?? missing}`);
    else if (v.expires_at && v.expires_at.getTime() < job.deadline.getTime()) {
      reasons.push(label === 'notary' ? 'notary_commission_expires_before_deadline' : 'attorney_check_expires_before_deadline');
    }
  };
  const needsNotary = job.task_type === 'notarization' || rules.includes('L1');
  const needsAttorney = rules.includes('L2');
  if (needsNotary) await licence('notary_commission', 'notary', 'no verification on file');
  if (needsAttorney) await licence('attorney_license', 'attorney', 'no State Bar check on file (verify with your bar number)');
  // Licensed work is tied to a real, verified person: notary and legal jobs need a verified identity whatever IDENTITY_GATE says.
  const licensedWork = needsNotary || needsAttorney;
  let advisory: string | null = null;
  if (profile.identityRequired || licensedWork) {
    const v = await deps.repo.getWorkerVerification(worker.id, 'identity');
    if (!v || v.status !== 'verified') {
      const has = v ? `identity verification is ${v.status}` : 'no identity verification on file';
      const reason = licensedWork
        ? `identity_not_verified: notary and legal jobs need a verified identity, so the licence is tied to the person; ${has} (start one with verify_identity)`
        : `identity_not_verified: tier ${profile.tier} job requires a verified identity; ${has} (start one with verify_identity)`;
      if (profile.identityEnforced || licensedWork) reasons.push(reason);
      else advisory = `${reason}; not enforced (IDENTITY_GATE=log)`;
    }
  }
  return { eligible: reasons.length === 0, reasons: advisory ? [...reasons, advisory] : reasons, tier: profile.tier };
}
