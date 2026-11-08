import type { Env } from '../env.js';
import { fire, type Hooks } from '../hooks.js';
import { InvalidStateError, NotFoundError } from '../errors.js';
import type { Repo } from '../repo.js';
import type { Job, Proof, ProofCheck, ProofDecision, ProofMedia, ProofReview } from '../types.js';
import { runChecks, type ChecksDeps } from './checks.js';
import { describeProfile, profileData, TIER_RULES, verificationProfile, type VerificationProfile } from './profile.js';
import { VisionError, type VisionScorer } from './vision.js';

/** The tier-1 bar, kept for callers that reason about one number; the tiers are in proof/profile.ts. */
export const CONFIDENCE_THRESHOLD = TIER_RULES[1].confidenceThreshold;

/** Returns image URLs or data: URLs of sampled frames. */
export type FrameExtractor = (media: ProofMedia) => Promise<string[]>;

export interface DecideDeps extends ChecksDeps {
  repo: Repo;
  hooks?: Hooks;
  vision?: VisionScorer | null;
  frameExtractor?: FrameExtractor;
  now?: () => Date;
  /** Replaces the tier's confidence threshold for every job (tests, an emergency). Normally unset. */
  confidenceThreshold?: number;
  /** IDENTITY_GATE; without env the tier-2 identity rule is enforced. */
  env?: Pick<Env, 'IDENTITY_GATE'>;
}

const profileFor = (deps: DecideDeps, job: Job): VerificationProfile => verificationProfile(job, { identityGate: deps.env?.IDENTITY_GATE });

function note(name: string, status: ProofCheck['status'], detail: string, data?: Record<string, unknown>): ProofCheck {
  return { name, status, pass: status === 'pass', detail, ...(data ? { data } : {}) };
}

const isHardFail = (c: ProofCheck) => (c.name === 'geofence' || c.name === 'reuse') && c.status === 'fail';

const thresholdFor = (deps: DecideDeps, profile: VerificationProfile): number => deps.confidenceThreshold ?? profile.confidenceThreshold;

/** First entry of every automated review: which tier applied and why, so check_proof evidence shows it. */
const profileCheck = (profile: VerificationProfile): ProofCheck => note('profile', 'pass', describeProfile(profile), profileData(profile));

/**
 * Tier 2: the worker must hold a verified Stripe Identity. Only the status goes into the review; the
 * verified name stays in worker_verifications. Under IDENTITY_GATE=log the check is recorded (enforced
 * false, verified true or false) and passes, so it never blocks a review or an approval.
 */
async function identityCheck(repo: Pick<Repo, 'getWorkerVerification'>, workerId: string, profile: VerificationProfile): Promise<ProofCheck> {
  const v = await repo.getWorkerVerification(workerId, 'identity');
  const verified = v?.status === 'verified';
  const data = { status: v?.status ?? null, enforced: profile.identityEnforced, verified, ...(verified ? { verified_at: v.verified_at?.toISOString() ?? null } : {}) };
  if (verified) return note('identity', 'pass', 'verified identity on file', data);
  const has = v ? `identity verification is ${v.status}` : 'no identity verification on file';
  if (!profile.identityEnforced) {
    return note('identity', 'pass', `${has}; not enforced (IDENTITY_GATE=log), so it does not block approval`, data);
  }
  return note('identity', 'needs_review', `tier ${profile.tier} requires a verified identity; ${has} (the worker starts one with verify_identity)`, data);
}

async function loadProofAndJob(repo: Repo, proofId: string): Promise<{ proof: Proof; job: Job }> {
  const proof = await repo.getProof(proofId);
  if (!proof) throw new NotFoundError('proof', proofId);
  const job = await repo.getJob(proof.job_id);
  if (!job) throw new NotFoundError('job', proof.job_id);
  return { proof, job };
}

/** Collect image URLs; video becomes frames if we can extract them, else a manual-review flag. */
async function gatherImageUrls(deps: DecideDeps, proof: Proof, checks: ProofCheck[]): Promise<string[]> {
  const urls: string[] = [];
  for (const m of proof.media) {
    if (m.mime.startsWith('image/')) urls.push(m.url);
    else if (m.mime.startsWith('video/')) {
      if (deps.frameExtractor) urls.push(...(await deps.frameExtractor(m)));
      else checks.push(note('video', 'needs_review', 'video proof needs manual review (no frame extractor configured)'));
    }
  }
  return urls;
}

/** Run the vision scorer and fold its verdict (or its failure) into a check. Returns the confidence if scored. */
async function runVision(
  deps: DecideDeps,
  job: Job,
  imageUrls: string[],
  checks: ProofCheck[],
  threshold: number,
): Promise<number | null> {
  if (!deps.vision) {
    checks.push(note('vision', 'needs_review', 'no vision scorer configured'));
    return null;
  }
  if (imageUrls.length === 0) {
    checks.push(note('vision', 'needs_review', 'no images available for vision scoring'));
    return null;
  }
  try {
    const score = await deps.vision.score({
      imageUrls,
      mustShow: job.proof_schema.photos.must_show,
      instructions: `${job.task_type} job ${job.id}`,
    });
    const missing = job.proof_schema.photos.must_show.filter((item) => score.mustShowFound[item] !== true);
    const data = { confidence: score.confidence, must_show_found: score.mustShowFound, notes: score.notes };
    if (score.confidence >= threshold && missing.length === 0) {
      checks.push(note('vision', 'pass', `confidence ${score.confidence}; ${score.notes}`.trim(), data));
    } else {
      const parts = [`confidence ${score.confidence} (threshold ${threshold})`];
      if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
      if (score.notes) parts.push(score.notes);
      checks.push(note('vision', 'needs_review', parts.join('; '), data));
    }
    return score.confidence;
  } catch (err) {
    if (err instanceof VisionError) {
      checks.push(note('vision', 'needs_review', err.message));
      return null;
    }
    throw err;
  }
}

interface Assessment {
  proof: Proof;
  job: Job;
  checks: ProofCheck[];
  decision: ProofDecision;
  confidence: number | null;
}

/** The automated review's checks and verdict, computed but not recorded (reviewProof records them). */
async function assessProof(deps: DecideDeps, proofId: string): Promise<Assessment> {
  const { proof, job } = await loadProofAndJob(deps.repo, proofId);
  const profile = profileFor(deps, job);
  const { checks: deterministic } = await runChecks(deps, job, proof, profile);
  const checks: ProofCheck[] = [profileCheck(profile), ...deterministic];

  let decision: ProofDecision;
  let confidence: number | null = null;
  if (checks.some(isHardFail)) {
    decision = 'rejected';
  } else {
    if (profile.identityRequired) checks.push(await identityCheck(deps.repo, proof.worker_id, profile));
    const imageUrls = await gatherImageUrls(deps, proof, checks);
    confidence = await runVision(deps, job, imageUrls, checks, thresholdFor(deps, profile));
    decision = checks.every((c) => c.status === 'pass') ? 'approved' : 'escalated';
    // Any non-hard 'fail' (e.g. completeness) is still not auto-approvable; it goes to a human.
  }
  return { proof, job, checks, decision, confidence };
}

/**
 * Automated review under the job's verification profile: deterministic checks first, then (unless a fraud
 * signal already rejected it) the tier-2 identity gate and the vision scorer. Approved only when every check
 * passes, so a tier-2 proof from a worker without a verified identity always escalates.
 */
export async function reviewProof(deps: DecideDeps, proofId: string): Promise<ProofReview> {
  const { proof, job, checks, decision, confidence } = await assessProof(deps, proofId);
  const review = await deps.repo.upsertProofReview({
    proof_id: proof.id,
    job_id: job.id,
    confidence,
    decision,
    checks,
    reviewer: 'auto',
  });
  await fire(deps.hooks, 'onProofDecision', job.id, proof.id, decision);
  return review;
}

/**
 * Record a human or agent decision on top of `base`. Each `current` check takes the place of the stored check with
 * the same name (or is added), so a re-checked fact (the live identity) does not leave a stale entry in the flags.
 */
async function recordManual(
  deps: DecideDeps,
  base: Pick<ProofReview, 'proof_id' | 'job_id' | 'confidence' | 'checks'>,
  decision: ProofDecision,
  reviewer: string,
  detail: string,
  current: ProofCheck[] = [],
): Promise<ProofReview> {
  const kept = base.checks.map((c) => current.find((n) => n.name === c.name) ?? c);
  const added = current.filter((n) => !base.checks.some((c) => c.name === n.name));
  const review = await deps.repo.upsertProofReview({
    proof_id: base.proof_id,
    job_id: base.job_id,
    confidence: base.confidence,
    decision,
    checks: [...kept, ...added, note('reviewer_note', 'pass', detail)],
    reviewer,
  });
  await fire(deps.hooks, 'onProofDecision', review.job_id, review.proof_id, decision);
  return review;
}

/** Existing review if any, else run one now so the deterministic checks are always on record. */
async function reviewOnRecord(deps: DecideDeps, proofId: string): Promise<ProofReview> {
  return (await deps.repo.getProofReview(proofId)) ?? (await reviewProof(deps, proofId));
}

/**
 * Human or agent approval. Out-of-fence and reused media can never be overridden (fraud signals, not
 * judgment calls), nor can a missing identity on a tier-2 job under IDENTITY_GATE=enforce. A stored
 * completeness or time failure (too few photos or missing fields; a capture time outside the window) and a
 * confidence under the tier's threshold can, but only on an explicit override. needs_review flags are left
 * to the reviewer's judgement. The identity is checked live rather than read from the stored review, and the
 * live check replaces the stored one, so a worker who verified after the automated review is not blocked or
 * reported by a stale check.
 */
export async function approveProof(
  deps: DecideDeps,
  input: { proofId: string; reviewer: string; notes?: string; override?: boolean },
): Promise<ProofReview> {
  const { proof, job } = await loadProofAndJob(deps.repo, input.proofId);
  const review = await reviewOnRecord(deps, input.proofId);
  const profile = profileFor(deps, job);
  const failure = (name: string) => review.checks.find((c) => c.name === name && c.status === 'fail');
  if (failure('geofence')) throw new InvalidStateError('outside_geofence: proof was captured outside the job geofence');
  if (failure('reuse')) throw new InvalidStateError('reused_media: proof media was already used on another job');
  const incomplete = failure('completeness');
  if (incomplete && !input.override) throw new InvalidStateError(`incomplete: ${incomplete.detail}; pass override to approve anyway`);
  const late = failure('time');
  if (late && !input.override) throw new InvalidStateError(`outside_time_window: ${late.detail}; pass override to approve anyway`);
  const current: ProofCheck[] = [];
  if (profile.identityRequired) {
    const identity = await identityCheck(deps.repo, proof.worker_id, profile);
    if (identity.status !== 'pass') throw new InvalidStateError(`identity_unverified: ${identity.detail}`);
    current.push(identity);
  }
  const threshold = thresholdFor(deps, profile);
  if (!input.override && (review.confidence === null || review.confidence < threshold)) {
    throw new InvalidStateError(
      `below_threshold: confidence ${review.confidence ?? 'n/a'} is under ${threshold}; pass override to approve anyway`,
    );
  }
  return recordManual(deps, review, 'approved', input.reviewer, input.notes ?? '', current);
}

/**
 * An approval already moved the job to approved and woke Finance (capture, then payout); contracts/states.ts has no
 * way back. Overwriting it would leave the review contradicting the job, and payWorker refusing a worker whose
 * customer was already charged. So an approved review is final here: a bad proof found later is a refund or dispute.
 */
function refuseIfApproved(review: ProofReview, outcome: 'escalated' | 'rejected'): void {
  if (review.decision !== 'approved') return;
  throw new InvalidStateError(
    `already_approved: proof ${review.proof_id} is already approved and job ${review.job_id} is being paid ` +
      `(capture and payout follow approval), so it cannot be ${outcome}. A genuinely bad proof now goes to the ` +
      'refund/dispute path (refund or refund_large, or a Stripe dispute), not to escalate; put the reason in your final answer.',
  );
}

/**
 * Escalate or reject on top of the review on record (refused once that is an approval), or, with none yet, on the
 * automated checks computed now but not recorded: recording them would fire their own decision first, and an
 * explicit escalate must never start by approving the proof and waking Finance.
 */
async function recordEscalationOrRejection(
  deps: DecideDeps,
  input: { proofId: string; reviewer: string; reason: string },
  decision: 'escalated' | 'rejected',
): Promise<ProofReview> {
  const stored = await deps.repo.getProofReview(input.proofId);
  if (stored) {
    refuseIfApproved(stored, decision);
    return recordManual(deps, stored, decision, input.reviewer, input.reason);
  }
  const { proof, job, checks, confidence } = await assessProof(deps, input.proofId);
  return recordManual(deps, { proof_id: proof.id, job_id: job.id, confidence, checks }, decision, input.reviewer, input.reason);
}

export async function escalateProof(
  deps: DecideDeps,
  input: { proofId: string; reviewer: string; reason: string },
): Promise<ProofReview> {
  return recordEscalationOrRejection(deps, input, 'escalated');
}

export async function rejectProof(
  deps: DecideDeps,
  input: { proofId: string; reviewer: string; reason: string },
): Promise<ProofReview> {
  return recordEscalationOrRejection(deps, input, 'rejected');
}
