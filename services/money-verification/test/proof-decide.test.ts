import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { InvalidStateError } from '../src/errors.js';
import {
  approveProof,
  escalateProof,
  rejectProof,
  reviewProof,
  type DecideDeps,
} from '../src/proof/decide.js';
import type { ExifData } from '../src/proof/exif.js';
import { VisionError, type VisionInput, type VisionScore, type VisionScorer } from '../src/proof/vision.js';
import type { Job, Proof } from '../src/types.js';
import { MINUTE_MS, PROOF_ID, T0, YC, makeJob, makeProof, makeWorld, seedVerifiedIdentity } from './helpers.js';

const metersNorth = (m: number) => YC.lat + m / 111_195;
const IMG = 'https://blob.test/proof-1.jpg';
const goodExif = (lat = YC.lat): ExifData => ({
  lat,
  lng: YC.lng,
  capturedAt: new Date(T0.getTime() - 30 * MINUTE_MS),
  tzAssumed: false,
});

class FakeScorer implements VisionScorer {
  calls: VisionInput[] = [];
  constructor(private result: VisionScore | Error) {}
  async score(input: VisionInput): Promise<VisionScore> {
    this.calls.push(input);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

const found = (...items: string[]): Record<string, boolean> => Object.fromEntries(items.map((i) => [i, true]));

interface Setup {
  job?: Partial<Job>;
  proof?: Partial<Proof>;
  exif?: ExifData;
  scorer?: FakeScorer;
}

function setup(opts: Setup = {}) {
  const world = makeWorld();
  const job = world.repo.seedJob(makeJob(opts.job));
  const proof = world.repo.seedProof(makeProof(opts.proof));
  const exif = opts.exif ?? goodExif();
  const deps: DecideDeps = {
    repo: world.repo,
    hooks: world.hooks,
    vision: opts.scorer ?? null,
    // Stub bytes carry no meaning; readExif is stubbed to return the programmed EXIF.
    readMedia: async () => new Uint8Array([0]),
    readExif: async () => exif,
  };
  return { world, job, proof, deps };
}

const check = (r: { checks: { name: string }[] }, name: string) => r.checks.find((c) => c.name === name) as
  | { name: string; status: string; detail: string }
  | undefined;
/** The checks that kept a review from passing, so a test can pin the one reason it escalated. */
const flagged = (r: { checks: { name: string; status: string }[] }) => r.checks.filter((c) => c.status !== 'pass').map((c) => c.name);

describe('reviewProof', () => {
  it('(a) approves when everything passes', async () => {
    const scorer = new FakeScorer({ confidence: 0.9, mustShowFound: found('sign'), notes: 'ok' });
    const { world, deps } = setup({
      job: { proof_schema: { photos: { min: 1, must_show: ['sign'] }, geofence_m: 150 } },
      scorer,
    });
    await seedVerifiedIdentity(world);
    const review = await reviewProof(deps, PROOF_ID);
    expect(review.decision).toBe('approved');
    expect(review.confidence).toBe(0.9);
    expect(review.reviewer).toBe('auto');
    expect(world.fired.filter((f) => f.name === 'onProofDecision')).toEqual([
      { name: 'onProofDecision', args: [review.job_id, PROOF_ID, 'approved'] },
    ]);
    expect(await world.repo.getProofReview(PROOF_ID)).toMatchObject({ decision: 'approved' });
    expect(scorer.calls[0]?.mustShow).toEqual(['sign']);
  });

  it('(b) rejects outside the geofence without calling the scorer', async () => {
    const scorer = new FakeScorer({ confidence: 0.99, mustShowFound: {}, notes: '' });
    const { deps } = setup({ exif: goodExif(metersNorth(300)), scorer });
    const review = await reviewProof(deps, PROOF_ID);
    expect(review.decision).toBe('rejected');
    expect(review.confidence).toBeNull();
    expect(check(review, 'geofence')?.status).toBe('fail');
    expect(scorer.calls).toHaveLength(0);
  });

  it('(c) rejects reused media', async () => {
    const scorer = new FakeScorer({ confidence: 0.99, mustShowFound: {}, notes: '' });
    const { world, deps } = setup({ scorer });
    world.repo.seedProof(makeProof({ id: 'elsewhere', job_id: 'other-job' }));
    const review = await reviewProof(deps, PROOF_ID);
    expect(review.decision).toBe('rejected');
    expect(check(review, 'reuse')?.status).toBe('fail');
    expect(scorer.calls).toHaveLength(0);
  });

  it('(d) escalates when the file has no EXIF (device GPS inside the fence)', async () => {
    const scorer = new FakeScorer({ confidence: 0.95, mustShowFound: {}, notes: '' });
    const { world, deps } = setup({ scorer });
    await seedVerifiedIdentity(world); // so the missing EXIF time is the only reason to escalate
    const real: DecideDeps = { ...deps, readExif: undefined, readMedia: async () => new Uint8Array(64).fill(7) };
    const review = await reviewProof(real, PROOF_ID);
    expect(review.decision).toBe('escalated');
    expect(flagged(review)).toEqual(['time']);
    expect(check(review, 'time')?.status).toBe('needs_review');
    expect(check(review, 'geofence')?.status).toBe('pass');
  });

  it('(e) escalates at confidence 0.7', async () => {
    const { world, deps } = setup({ scorer: new FakeScorer({ confidence: 0.7, mustShowFound: {}, notes: '' }) });
    await seedVerifiedIdentity(world);
    const review = await reviewProof(deps, PROOF_ID);
    expect(review.decision).toBe('escalated');
    expect(flagged(review)).toEqual(['vision']);
    expect(review.confidence).toBe(0.7);
    expect(check(review, 'vision')?.status).toBe('needs_review');
  });

  it('(f) escalates when a must_show item is not found', async () => {
    const { world, deps } = setup({
      job: { proof_schema: { photos: { min: 1, must_show: ['sign', 'corner'] }, geofence_m: 150 } },
      scorer: new FakeScorer({ confidence: 0.95, mustShowFound: { sign: true, corner: false }, notes: '' }),
    });
    await seedVerifiedIdentity(world);
    const review = await reviewProof(deps, PROOF_ID);
    expect(review.decision).toBe('escalated');
    expect(flagged(review)).toEqual(['vision']);
    expect(check(review, 'vision')?.detail).toContain('corner');
  });

  it('(g) video without a frame extractor is flagged; with one the frames reach the scorer', async () => {
    const video = { url: 'https://blob.test/v.mp4', sha256: 'b'.repeat(64), mime: 'video/mp4' };
    const scorer = new FakeScorer({ confidence: 0.95, mustShowFound: {}, notes: '' });
    const first = setup({ proof: { media: [video] }, job: { proof_schema: { photos: { min: 0, must_show: [] } } }, scorer });
    const review = await reviewProof(first.deps, PROOF_ID);
    expect(review.decision).toBe('escalated');
    expect(check(review, 'video')?.status).toBe('needs_review');
    expect(scorer.calls).toHaveLength(0);

    const scorer2 = new FakeScorer({ confidence: 0.95, mustShowFound: {}, notes: '' });
    const second = setup({ proof: { media: [video] }, job: { proof_schema: { photos: { min: 0, must_show: [] } } }, scorer: scorer2 });
    const frames = ['data:image/jpeg;base64,AAA', 'data:image/jpeg;base64,BBB'];
    await reviewProof({ ...second.deps, frameExtractor: async () => frames }, PROOF_ID);
    expect(scorer2.calls[0]?.imageUrls).toEqual(frames);
  });

  it('(h) a VisionError escalates instead of crashing', async () => {
    const { world, deps } = setup({ scorer: new FakeScorer(new VisionError('vision request failed: HTTP 500')) });
    await seedVerifiedIdentity(world); // a verified worker: the scorer outage alone must stop the auto-approval
    const review = await reviewProof(deps, PROOF_ID);
    expect(review.decision).toBe('escalated');
    expect(flagged(review)).toEqual(['vision']);
    expect(check(review, 'vision')?.detail).toContain('HTTP 500');
  });

  it('escalates when no scorer is configured', async () => {
    const { world, deps } = setup();
    await seedVerifiedIdentity(world);
    const review = await reviewProof(deps, PROOF_ID);
    expect(review.decision).toBe('escalated');
    expect(flagged(review)).toEqual(['vision']);
    expect(check(review, 'vision')?.detail).toBe('no vision scorer configured');
  });
});

describe('manual decisions', () => {
  it('(i) approveProof refuses a geofence-failed review', async () => {
    const { deps } = setup({ exif: goodExif(metersNorth(300)) });
    await expect(approveProof(deps, { proofId: PROOF_ID, reviewer: 'ops', override: true })).rejects.toThrow(
      /^outside_geofence/,
    );
    await expect(approveProof(deps, { proofId: PROOF_ID, reviewer: 'ops', override: true })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
  });

  it('(i) approveProof refuses reused media', async () => {
    const { world, deps } = setup();
    world.repo.seedProof(makeProof({ id: 'elsewhere', job_id: 'other-job' }));
    await expect(approveProof(deps, { proofId: PROOF_ID, reviewer: 'ops', override: true })).rejects.toThrow(
      /^reused_media/,
    );
  });

  it('(i) low confidence needs override, then approves with a reviewer note', async () => {
    const { world, deps } = setup({ scorer: new FakeScorer({ confidence: 0.6, mustShowFound: {}, notes: '' }) });
    await seedVerifiedIdentity(world);
    await reviewProof(deps, PROOF_ID);
    await expect(approveProof(deps, { proofId: PROOF_ID, reviewer: 'ops' })).rejects.toThrow(/^below_threshold/);

    const approved = await approveProof(deps, { proofId: PROOF_ID, reviewer: 'ops', override: true, notes: 'looked fine' });
    expect(approved.decision).toBe('approved');
    expect(approved.reviewer).toBe('ops');
    expect(check(approved, 'reviewer_note')).toMatchObject({ status: 'pass', detail: 'looked fine' });
    expect(world.fired.at(-1)?.args).toEqual([approved.job_id, PROOF_ID, 'approved']);
  });

  it('approveProof runs the review first when none exists, and refuses null confidence', async () => {
    const { world, deps } = setup();
    await seedVerifiedIdentity(world);
    await expect(approveProof(deps, { proofId: PROOF_ID, reviewer: 'ops' })).rejects.toThrow(/^below_threshold/);
    expect(await world.repo.getProofReview(PROOF_ID)).not.toBeNull();
  });

  it('(i) escalateProof and rejectProof record the reason', async () => {
    const { deps } = setup({ scorer: new FakeScorer({ confidence: 0.95, mustShowFound: {}, notes: '' }) });
    const esc = await escalateProof(deps, { proofId: PROOF_ID, reviewer: 'ops', reason: 'odd lighting' });
    expect(esc.decision).toBe('escalated');
    expect(check(esc, 'reviewer_note')?.detail).toBe('odd lighting');
    const rej = await rejectProof(deps, { proofId: PROOF_ID, reviewer: 'ops', reason: 'screenshot' });
    expect(rej.decision).toBe('rejected');
    expect(rej.reviewer).toBe('ops');
  });
});

describe('real fixture end to end', () => {
  it('(j) real readExif on proof-gps.jpg: geofence and time pass, approved', async () => {
    const bytes = new Uint8Array(readFileSync(new URL('./fixtures/proof-gps.jpg', import.meta.url)));
    const scorer = new FakeScorer({ confidence: 0.92, mustShowFound: {}, notes: 'looks right' });
    const { world, deps } = setup({ scorer });
    await seedVerifiedIdentity(world);
    // Fixture's GPS is the job location; the default proof's device GPS is too, so no consistency flag.
    const review = await reviewProof({ ...deps, readExif: undefined, readMedia: async () => bytes }, PROOF_ID);
    expect(check(review, 'geofence')?.status).toBe('pass');
    expect(check(review, 'time')?.status).toBe('pass');
    expect(review.decision).toBe('approved');
  });
});
