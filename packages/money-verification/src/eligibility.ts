import { NotFoundError } from './errors.js';
import type { Repo } from './repo.js';

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

/**
 * Can this worker take this job? Cheap gate the job page calls before "Yes": not suspended, tier high
 * enough, and for a notarization job a notary commission verified (verify_notary) that does not expire
 * before the deadline. Identity verification is optional per the README and not required here.
 */
export async function checkEligibility(
  deps: { repo: Pick<Repo, 'getJob' | 'getWorker' | 'getWorkerVerification'> },
  input: { workerId: string; jobId: string },
): Promise<EligibilityResult> {
  const [job, worker] = await Promise.all([deps.repo.getJob(input.jobId), deps.repo.getWorker(input.workerId)]);
  if (!job) throw new NotFoundError('job', input.jobId);
  if (!worker) throw new NotFoundError('worker', input.workerId);

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
  return { eligible: reasons.length === 0, reasons };
}
