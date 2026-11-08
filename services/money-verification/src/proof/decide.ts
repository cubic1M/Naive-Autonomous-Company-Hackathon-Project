import { fire, type Hooks } from '../hooks.js';
import { InvalidStateError, NotFoundError } from '../errors.js';
import type { Repo } from '../repo.js';
import type { Job, Proof, ProofCheck, ProofDecision, ProofMedia, ProofReview } from '../types.js';
import { runChecks, type ChecksDeps } from './checks.js';
import { VisionError, type VisionScorer } from './vision.js';

export const CONFIDENCE_THRESHOLD = 0.85;

/** Returns image URLs or data: URLs of sampled frames. */
export type FrameExtractor = (media: ProofMedia) => Promise<string[]>;

export interface DecideDeps extends ChecksDeps {
  repo: Repo;
  hooks?: Hooks;
  vision?: VisionScorer | null;
  frameExtractor?: FrameExtractor;
  now?: () => Date;
  confidenceThreshold?: number;
}

function note(name: string, status: ProofCheck['status'], detail: string, data?: Record<string, unknown>): ProofCheck {
  return { name, status, pass: status === 'pass', detail, ...(data ? { data } : {}) };
}

const isHardFail = (c: ProofCheck) => (c.name === 'geofence' || c.name === 'reuse') && c.status === 'fail';

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
): Promise<number | null> {
  if (!deps.vision) {
    checks.push(note('vision', 'needs_review', 'no vision scorer configured'));
    return null;
  }
  if (imageUrls.length === 0) {
    checks.push(note('vision', 'needs_review', 'no images available for vision scoring'));
    return null;
  }
  const threshold = deps.confidenceThreshold ?? CONFIDENCE_THRESHOLD;
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

/** Automated review: deterministic checks first, vision only for proofs that could still be approved. */
export async function reviewProof(deps: DecideDeps, proofId: string): Promise<ProofReview> {
  const { proof, job } = await loadProofAndJob(deps.repo, proofId);
  const { checks } = await runChecks(deps, job, proof);

  let decision: ProofDecision;
  let confidence: number | null = null;
  if (checks.some(isHardFail)) {
    decision = 'rejected';
  } else {
    const imageUrls = await gatherImageUrls(deps, proof, checks);
    confidence = await runVision(deps, job, imageUrls, checks);
    decision = checks.every((c) => c.status === 'pass') ? 'approved' : 'escalated';
    // Any non-hard 'fail' (e.g. completeness) is still not auto-approvable; it goes to a human.
  }

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

async function recordManual(
  deps: DecideDeps,
  base: ProofReview,
  decision: ProofDecision,
  reviewer: string,
  detail: string,
): Promise<ProofReview> {
  const review = await deps.repo.upsertProofReview({
    proof_id: base.proof_id,
    job_id: base.job_id,
    confidence: base.confidence,
    decision,
    checks: [...base.checks, note('reviewer_note', 'pass', detail)],
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
 * Human approval. Out-of-fence and reused media can never be overridden (fraud signals, not judgment
 * calls); low confidence can, but only on an explicit override.
 */
export async function approveProof(
  deps: DecideDeps,
  input: { proofId: string; reviewer: string; notes?: string; override?: boolean },
): Promise<ProofReview> {
  const review = await reviewOnRecord(deps, input.proofId);
  const failed = (name: string) => review.checks.some((c) => c.name === name && c.status === 'fail');
  if (failed('geofence')) throw new InvalidStateError('outside_geofence: proof was captured outside the job geofence');
  if (failed('reuse')) throw new InvalidStateError('reused_media: proof media was already used on another job');
  const threshold = deps.confidenceThreshold ?? CONFIDENCE_THRESHOLD;
  if (!input.override && (review.confidence === null || review.confidence < threshold)) {
    throw new InvalidStateError(
      `below_threshold: confidence ${review.confidence ?? 'n/a'} is under ${threshold}; pass override to approve anyway`,
    );
  }
  return recordManual(deps, review, 'approved', input.reviewer, input.notes ?? '');
}

export async function escalateProof(
  deps: DecideDeps,
  input: { proofId: string; reviewer: string; reason: string },
): Promise<ProofReview> {
  return recordManual(deps, await reviewOnRecord(deps, input.proofId), 'escalated', input.reviewer, input.reason);
}

export async function rejectProof(
  deps: DecideDeps,
  input: { proofId: string; reviewer: string; reason: string },
): Promise<ProofReview> {
  return recordManual(deps, await reviewOnRecord(deps, input.proofId), 'rejected', input.reviewer, input.reason);
}
