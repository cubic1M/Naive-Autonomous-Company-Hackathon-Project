import { describe, expect, it } from 'vitest';
import { createContractTools } from '../src/contract-tools.js';
import { checkEligibility } from '../src/eligibility.js';
import { approveProof, reviewProof, type DecideDeps } from '../src/proof/decide.js';
import type { ExifData } from '../src/proof/exif.js';
import type { VisionInput, VisionScorer } from '../src/proof/vision.js';
import type { Job, Proof, ProofCheck } from '../src/types.js';
import { HOUR_MS, JOB_ID, MINUTE_MS, PROOF_ID, T0, WORKER_ID, YC, makeJob, makeProof, makeWorker, makeWorld, seedVerifiedIdentity } from './helpers.js';

const NO_EXIF: ExifData = { lat: null, lng: null, capturedAt: null, tzAssumed: false };
const FULL_EXIF: ExifData = { lat: YC.lat, lng: YC.lng, capturedAt: new Date(T0.getTime() - 30 * MINUTE_MS), tzAssumed: false };

class CountingScorer implements VisionScorer {
  calls: VisionInput[] = [];
  constructor(private readonly confidence: number) {}
  async score(input: VisionInput) {
    this.calls.push(input);
    return { confidence: this.confidence, mustShowFound: Object.fromEntries(input.mustShow.map((m) => [m, true])), notes: 'ok' };
  }
}

const img = (n: number) => ({ url: `https://blob.test/${n}.jpg`, sha256: String(n).repeat(64).slice(0, 64), mime: 'image/jpeg' });
const twoPhotos = { media: [img(1), img(2)] };
const check = (r: { checks: ProofCheck[] }, name: string) => r.checks.find((c) => c.name === name);

function setup(opts: { job?: Partial<Job>; proof?: Partial<Proof>; exif?: ExifData; confidence?: number } = {}) {
  const world = makeWorld();
  world.repo.seedJob(makeJob(opts.job));
  world.repo.seedWorker(makeWorker());
  world.repo.seedProof(makeProof(opts.proof));
  const vision = new CountingScorer(opts.confidence ?? 0.95);
  const deps: DecideDeps = {
    repo: world.repo,
    hooks: world.hooks,
    vision,
    readMedia: async () => new Uint8Array([0]),
    readExif: async () => opts.exif ?? FULL_EXIF,
  };
  return { world, deps, vision };
}

describe('tier 0 (under $50): device data is enough', () => {
  it('approves a proof with no EXIF when device GPS and captured_at are inside the fence and window', async () => {
    const { deps } = setup({ job: { budget_cents: 3000 }, exif: NO_EXIF, confidence: 0.82 });
    const review = await reviewProof(deps, PROOF_ID);
    expect(review.decision).toBe('approved');
    expect(check(review, 'profile')).toMatchObject({ status: 'pass', data: { tier: 0, confidence_threshold: 0.8, exif_time_policy: 'device_fallback' } });
    expect(check(review, 'time')).toMatchObject({ status: 'pass', data: { source: 'device' } });
    expect(check(review, 'geofence')).toMatchObject({ status: 'pass', data: { source: 'device' } });
    expect(check(review, 'vision')?.status).toBe('pass');
  });

  it('the same proof at tier 1 ($60) escalates: EXIF capture time is required', async () => {
    const { deps } = setup({ job: { budget_cents: 6000 }, exif: NO_EXIF, confidence: 0.95 });
    const review = await reviewProof(deps, PROOF_ID);
    expect(review.decision).toBe('escalated');
    expect(check(review, 'profile')?.data).toMatchObject({ tier: 1, exif_time_policy: 'require' });
    expect(check(review, 'time')).toMatchObject({ status: 'needs_review' });
    expect(check(review, 'time')?.detail).toMatch(/missing EXIF capture time/);
  });

  it('tier 0 still escalates when the device captured_at is missing too', async () => {
    const { deps } = setup({ job: { budget_cents: 3000 }, proof: { captured_at: null }, exif: NO_EXIF });
    const review = await reviewProof(deps, PROOF_ID);
    expect(review.decision).toBe('escalated');
    expect(check(review, 'time')).toMatchObject({ status: 'needs_review' });
  });

  it('tier 0 escalates when the device captured_at is after the deadline', async () => {
    const { deps } = setup({ job: { budget_cents: 3000 }, proof: { captured_at: new Date(T0.getTime() + 5 * HOUR_MS) }, exif: NO_EXIF });
    const review = await reviewProof(deps, PROOF_ID);
    expect(review.decision).toBe('escalated');
    expect(check(review, 'time')).toMatchObject({ status: 'fail' });
  });

  it('tier 0 keeps its own bar: 0.78 escalates, and approveProof names 0.8', async () => {
    const { deps } = setup({ job: { budget_cents: 3000 }, exif: NO_EXIF, confidence: 0.78 });
    const review = await reviewProof(deps, PROOF_ID);
    expect(review.decision).toBe('escalated');
    expect(check(review, 'vision')?.detail).toContain('threshold 0.8');
    await expect(approveProof(deps, { proofId: PROOF_ID, reviewer: 'verifier-agent' })).rejects.toThrow(/below_threshold.*0\.8/);
  });
});

describe('tier 2 (over $150 or certification): identity and two photos', () => {
  it('escalates without a verified identity even at confidence 0.95; the vision still ran for the evidence', async () => {
    const { deps, vision } = setup({ job: { budget_cents: 24000 }, proof: twoPhotos, confidence: 0.95 });
    const review = await reviewProof(deps, PROOF_ID);
    expect(review.decision).toBe('escalated');
    expect(review.confidence).toBe(0.95);
    expect(check(review, 'identity')).toMatchObject({ status: 'needs_review', data: { status: null } });
    expect(check(review, 'identity')?.detail).toMatch(/tier 2/);
    expect(check(review, 'identity')?.detail).toMatch(/verify_identity/);
    expect(check(review, 'profile')?.data).toMatchObject({ tier: 2, identity_required: true, min_photos: 2, confidence_threshold: 0.9 });
    expect(vision.calls).toHaveLength(1);
  });

  it('a pending identity is named as such', async () => {
    const { world, deps } = setup({ job: { budget_cents: 24000 }, proof: twoPhotos });
    await world.repo.upsertWorkerVerification({ worker_id: WORKER_ID, kind: 'identity', status: 'pending', provider_ref: 'vs_1', details: {}, verified_at: null, expires_at: null });
    const review = await reviewProof(deps, PROOF_ID);
    expect(review.decision).toBe('escalated');
    expect(check(review, 'identity')).toMatchObject({ status: 'needs_review', data: { status: 'pending' } });
  });

  it('approves with a verified identity, two photos with EXIF, and 0.95', async () => {
    const { world, deps } = setup({ job: { budget_cents: 24000 }, proof: twoPhotos, confidence: 0.95 });
    await seedVerifiedIdentity(world);
    const review = await reviewProof(deps, PROOF_ID);
    expect(review.decision).toBe('approved');
    expect(check(review, 'identity')).toMatchObject({ status: 'pass', data: { status: 'verified' } });
    expect(JSON.stringify(check(review, 'identity'))).not.toContain('Example'); // no PII in the proof review
  });

  it('one photo is not enough at tier 2', async () => {
    const { world, deps } = setup({ job: { budget_cents: 24000 }, confidence: 0.95 });
    await seedVerifiedIdentity(world);
    const review = await reviewProof(deps, PROOF_ID);
    expect(review.decision).toBe('escalated');
    expect(check(review, 'completeness')).toMatchObject({ status: 'fail' });
    expect(check(review, 'completeness')?.detail).toMatch(/need 2/);
  });

  it('0.87 is under the tier-2 bar of 0.90', async () => {
    const { world, deps } = setup({ job: { budget_cents: 24000 }, proof: twoPhotos, confidence: 0.87 });
    await seedVerifiedIdentity(world);
    const review = await reviewProof(deps, PROOF_ID);
    expect(review.decision).toBe('escalated');
    expect(check(review, 'vision')?.detail).toContain('threshold 0.9');
    await expect(approveProof(deps, { proofId: PROOF_ID, reviewer: 'verifier-agent' })).rejects.toThrow(/below_threshold.*0\.9/);
  });

  it('a $60 notarization job is tier 2 and needs the identity', async () => {
    const { deps } = setup({ job: { budget_cents: 6000, task_type: 'notarization' }, proof: twoPhotos });
    const review = await reviewProof(deps, PROOF_ID);
    expect(review.decision).toBe('escalated');
    expect(check(review, 'profile')?.data).toMatchObject({ tier: 2, certification_required: true });
    expect(check(review, 'identity')?.status).toBe('needs_review');
  });

  it('approveProof never approves a tier-2 proof without a verified identity, even with override', async () => {
    const { world, deps } = setup({ job: { budget_cents: 24000 }, proof: twoPhotos, confidence: 0.95 });
    await expect(approveProof(deps, { proofId: PROOF_ID, reviewer: 'ops', override: true })).rejects.toThrow(/^identity_unverified/);
    expect((await world.repo.getProofReview(PROOF_ID))?.decision).toBe('escalated');
    expect(world.fired.filter((f) => f.name === 'onProofDecision' && f.args[2] === 'approved')).toHaveLength(0);
  });

  it('once the worker verifies, approveProof succeeds and the stored review records the identity pass', async () => {
    const { world, deps } = setup({ job: { budget_cents: 24000 }, proof: twoPhotos, confidence: 0.95 });
    const first = await reviewProof(deps, PROOF_ID);
    expect(first.decision).toBe('escalated');
    await seedVerifiedIdentity(world);
    const approved = await approveProof(deps, { proofId: PROOF_ID, reviewer: 'verifier-agent', notes: 'id verified now' });
    expect(approved.decision).toBe('approved');
    expect(approved.checks.filter((c) => c.name === 'identity').map((c) => c.status)).toEqual(['needs_review', 'pass']);
  });
});

describe('the tier reaches the agent: check_proof evidence and check_eligibility', () => {
  it('check_proof exposes tier and profile; a tier-0 proof on device data is approved through the contract adapter', async () => {
    const world = makeWorld();
    world.repo.seedJob(makeJob({ budget_cents: 3000, proof_schema: { photos: { min: 1, must_show: ['sign'] }, geofence_m: 150 } }));
    world.repo.seedWorker(makeWorker());
    world.repo.seedProof(makeProof());
    const contract = createContractTools({ ...world.deps, vision: new CountingScorer(0.85) }); // no readMedia: no EXIF at all
    const ev = await contract.check_proof({ job_id: JOB_ID });
    expect(ev.decision).toBe('approved');
    expect(ev.tier).toBe(0);
    expect(ev.profile).toMatchObject({ tier: 0, confidence_threshold: 0.8 });
    expect(ev.timestamp_ok).toBe(true);
    expect(ev.flags).toEqual([]);
  });

  it('check_proof on a default $60 job reports tier 1 and the usual escalation', async () => {
    const world = makeWorld();
    world.repo.seedJob(makeJob());
    world.repo.seedWorker(makeWorker());
    world.repo.seedProof(makeProof());
    const ev = await createContractTools({ ...world.deps, vision: new CountingScorer(0.95) }).check_proof({ job_id: JOB_ID });
    expect(ev.tier).toBe(1);
    expect(ev.decision).toBe('escalated');
    expect(ev.flags.some((f) => f.startsWith('time:'))).toBe(true);
    expect(ev.flags.some((f) => f.startsWith('profile:'))).toBe(false);
  });

  it('checkEligibility gates tier 2 on a verified identity and reports the tier', async () => {
    const world = makeWorld();
    world.repo.seedJob(makeJob({ budget_cents: 24000 }));
    world.repo.seedWorker(makeWorker());
    const before = await checkEligibility({ repo: world.repo }, { workerId: WORKER_ID, jobId: JOB_ID });
    expect(before.eligible).toBe(false);
    expect(before.tier).toBe(2);
    expect(before.reasons).toHaveLength(1);
    expect(before.reasons[0]).toMatch(/^identity_not_verified: /);
    expect(before.reasons[0]).toMatch(/no identity verification/);
    expect(before.reasons[0]).toMatch(/verify_identity/);

    await world.repo.upsertWorkerVerification({ worker_id: WORKER_ID, kind: 'identity', status: 'pending', provider_ref: 'vs_1', details: {}, verified_at: null, expires_at: null });
    expect((await checkEligibility({ repo: world.repo }, { workerId: WORKER_ID, jobId: JOB_ID })).reasons[0]).toMatch(/pending/);

    await seedVerifiedIdentity(world);
    expect(await checkEligibility({ repo: world.repo }, { workerId: WORKER_ID, jobId: JOB_ID })).toEqual({ eligible: true, reasons: [], tier: 2 });
  });

  it('tier 0 and 1 jobs never ask for an identity', async () => {
    const world = makeWorld();
    world.repo.seedJob(makeJob({ budget_cents: 6000 }));
    world.repo.seedWorker(makeWorker());
    expect(await checkEligibility({ repo: world.repo }, { workerId: WORKER_ID, jobId: JOB_ID })).toEqual({ eligible: true, reasons: [], tier: 1 });
  });
});

describe('contract adapters and the identity gate', () => {
  it('approve_proof answers identity_unverified for a tier-2 proof whose worker has no verified identity', async () => {
    const world = makeWorld();
    world.repo.seedJob(makeJob({ budget_cents: 24000 }));
    world.repo.seedWorker(makeWorker());
    world.repo.seedProof(makeProof(twoPhotos));
    const contract = createContractTools({ ...world.deps, vision: new CountingScorer(0.95) });
    expect(await contract.approve_proof({ job_id: JOB_ID, proof_id: PROOF_ID, notes: '' })).toEqual({ error: 'identity_unverified' });
    await seedVerifiedIdentity(world);
    expect(await contract.approve_proof({ job_id: JOB_ID, proof_id: PROOF_ID, notes: 'id on file' })).toEqual({ job_id: JOB_ID, status: 'approved' });
  });
});
