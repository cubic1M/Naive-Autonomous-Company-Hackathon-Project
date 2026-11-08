import { describe, expect, it } from 'vitest';
import { createContractTools } from '../src/contract-tools.js';
import { RequiresApprovalError } from '../src/errors.js';
import { escalateProof, recordFounderDecision, rejectProof } from '../src/proof/decide.js';
import type { VisionScorer } from '../src/proof/vision.js';
import { createTools } from '../src/tools.js';
import { handleStripeWebhook } from '../src/webhooks/stripe.js';
import { JOB_ID, PROOF_ID, WORKER_ID, YC, approvedReview, makeJob, makeProof, makeWorker, makeWorld, seedVerifiedIdentity, webhookRequest } from './helpers.js';

const scorer = (confidence: number): VisionScorer => ({
  async score(input) {
    return { confidence, mustShowFound: Object.fromEntries(input.mustShow.map((m) => [m, true])), notes: 'looks right' };
  },
});

async function fundedWorld(opts: { vision?: VisionScorer; budget?: number; account?: 'ready' | 'none' } = {}) {
  const world = makeWorld();
  const deps = { ...world.deps, vision: opts.vision ?? null };
  const job = world.repo.seedJob(makeJob({ budget_cents: opts.budget ?? 6000, proof_schema: { photos: { min: 1, must_show: ['YC sign'] }, geofence_m: 150 } }));
  if (opts.account === 'none') world.repo.seedWorker(makeWorker());
  else {
    const acct = await world.stripe.accounts.create({ type: 'express', metadata: { worker_id: WORKER_ID } });
    world.stripe.enablePayouts(acct.id);
    world.repo.seedWorker(makeWorker({ stripe_connect_account: acct.id }));
  }
  await seedVerifiedIdentity(world); // every job needs a worker with a verified identity
  world.repo.seedProof(makeProof());
  const tools = createTools(deps);
  await tools.create_escrow({ job_id: job.id });
  const sessionId = (await world.repo.getEscrow(job.id))?.stripe_checkout_session_id as string;
  await handleStripeWebhook(world.deps, webhookRequest(world, world.stripe.completeCheckout(sessionId)));
  return { world, contract: createContractTools(deps), tools };
}

describe('contracts/tools.ts adapters', () => {
  it('check_proof returns evidence in the contract shape and approve_proof then approves', async () => {
    const { world, contract } = await fundedWorld({ vision: scorer(0.95) });
    const ev = await contract.check_proof({ job_id: JOB_ID });
    expect(ev.proof_id).toBe(PROOF_ID);
    expect(ev.gps_distance_m).toBe(0); // device GPS at the job location
    expect(ev.timestamp_ok).toBe(false); // no EXIF time without readMedia
    expect(ev.checklist).toEqual([{ item: 'YC sign', found: true, confidence: 0.95 }]);
    expect(ev.overall_score).toBe(0.95);
    expect(ev.decision).toBe('escalated');
    expect(ev.flags.some((f) => f.startsWith('time:'))).toBe(true);
    expect(world.fired.filter((f) => f.name === 'onProofDecision')).toHaveLength(1);

    const approved = await contract.approve_proof({ job_id: JOB_ID, proof_id: PROOF_ID, notes: 'agent approves' });
    expect(approved).toEqual({ job_id: JOB_ID, status: 'approved' });
    // a human/agent decision is never overwritten by a later check_proof
    const again = await contract.check_proof({ job_id: JOB_ID });
    expect(again.decision).toBe('approved');
    expect((await world.repo.getProofReview(PROOF_ID))?.reviewer).toBe('verifier-agent');
  });

  it('approve_proof answers the contract error codes instead of throwing', async () => {
    const { world, contract } = await fundedWorld({ vision: scorer(0.5) });
    expect(await contract.approve_proof({ job_id: JOB_ID, proof_id: PROOF_ID, notes: '' })).toEqual({ error: 'below_threshold' });

    // 300 m north of the job -> outside the 150 m geofence
    world.repo.seedProof(makeProof({ gps_lat: YC.lat + 300 / 111_320 }));
    const ev = await contract.check_proof({ job_id: JOB_ID });
    expect(ev.decision).toBe('rejected');
    expect(ev.gps_distance_m).toBeGreaterThan(290);
    expect(await contract.approve_proof({ job_id: JOB_ID, proof_id: PROOF_ID, notes: '' })).toEqual({ error: 'outside_geofence' });
    expect(await contract.escalate({ job_id: JOB_ID, proof_id: PROOF_ID, reason: 'human look' })).toEqual({ job_id: JOB_ID, status: 'escalated' });
  });

  it('escalate after an automated approval is refused (tier 0 at 0.82): the review stays approved and the worker is paid', async () => {
    const { world, contract } = await fundedWorld({ vision: scorer(0.82), budget: 3000 });
    const ev = await contract.check_proof({ job_id: JOB_ID });
    expect(ev).toMatchObject({ decision: 'approved', tier: 0, overall_score: 0.82, profile: { confidence_threshold: 0.8 } });

    // A Verifier still applying a fixed 0.85 bar escalates; the approval (job approved, Finance woken) must stand.
    const out = await contract.escalate({ job_id: JOB_ID, proof_id: PROOF_ID, reason: 'overall_score 0.82 is under 0.85' });
    expect(out).toMatchObject({ job_id: JOB_ID, status: 'approved', error: 'already_approved' });
    expect('message' in out ? out.message : '').toMatch(/already approved and job \S+ is being paid.*refund\/dispute path/);
    const decideDeps = { repo: world.repo, hooks: world.hooks };
    await expect(escalateProof(decideDeps, { proofId: PROOF_ID, reviewer: 'verifier-agent', reason: 'again' })).rejects.toThrow(/^already_approved: .* cannot be escalated/);
    await expect(rejectProof(decideDeps, { proofId: PROOF_ID, reviewer: 'verifier-agent', reason: 'bad photo' })).rejects.toThrow(/^already_approved: .* cannot be rejected/);
    expect(await world.repo.getProofReview(PROOF_ID)).toMatchObject({ decision: 'approved', reviewer: 'auto', confidence: 0.82 });
    expect(world.fired.filter((f) => f.name === 'onProofDecision').map((f) => f.args[2])).toEqual(['approved']);

    expect(await contract.capture_payment({ job_id: JOB_ID })).toEqual({ job_id: JOB_ID, captured_usd: 30 });
    expect(await contract.payout({ job_id: JOB_ID })).toEqual({ job_id: JOB_ID, status: 'paid', worker_pay_usd: 22.5, fee_usd: 7.5 });
  });

  it('a founder approval of an escalated proof reaches proof_reviews, so capture and payout go through', async () => {
    const { world, contract } = await fundedWorld({ vision: scorer(0.95) });
    expect((await contract.check_proof({ job_id: JOB_ID })).decision).toBe('escalated'); // no EXIF time on a $60 job
    expect(await contract.payout({ job_id: JOB_ID }).catch((e: Error) => e.message)).toMatch(/proof is escalated; payout requires approved/);
    const review = await recordFounderDecision({ repo: world.repo, hooks: world.hooks }, { jobId: JOB_ID, decision: 'approved', note: 'photos look right' });
    expect(review).toMatchObject({ decision: 'approved', reviewer: 'founder' });
    expect(review.checks.at(-1)).toMatchObject({ name: 'reviewer_note', detail: 'founder: photos look right' });
    expect(await contract.capture_payment({ job_id: JOB_ID })).toEqual({ job_id: JOB_ID, captured_usd: 60 });
    expect(await contract.payout({ job_id: JOB_ID })).toEqual({ job_id: JOB_ID, status: 'paid', worker_pay_usd: 45, fee_usd: 15 });
  });

  it('a job accepted before every job needed an identity: agents cannot pay the unverified worker, a founder can, and the waiver is recorded', async () => {
    const world = makeWorld();
    world.repo.seedJob(makeJob({ budget_cents: 3000 }));
    world.repo.seedWorker(makeWorker());
    world.repo.seedProof(makeProof());
    const contract = createContractTools({ ...world.deps, vision: scorer(0.95) });
    expect((await contract.check_proof({ job_id: JOB_ID })).decision).toBe('escalated');
    expect(await contract.approve_proof({ job_id: JOB_ID, proof_id: PROOF_ID, notes: '' })).toEqual({ error: 'identity_unverified' });
    const deps = { repo: world.repo, hooks: world.hooks, vision: scorer(0.95), env: { IDENTITY_GATE: 'enforce' as const } };
    const review = await recordFounderDecision(deps, { jobId: JOB_ID, decision: 'approved' });
    expect(review).toMatchObject({ decision: 'approved', reviewer: 'founder' });
    expect(review.checks.filter((c) => c.name === 'identity')).toMatchObject([{ status: 'pass', data: { enforced: true, verified: false, waived_by: 'founder' } }]);
  });

  it('a founder approval waives an unenforceable identity on tier 2 (noted) but never a geofence failure', async () => {
    const world = makeWorld();
    world.repo.seedJob(makeJob({ budget_cents: 24000 }));
    world.repo.seedWorker(makeWorker());
    world.repo.seedProof(makeProof());
    const deps = { repo: world.repo, hooks: world.hooks, vision: scorer(0.95), env: { IDENTITY_GATE: 'enforce' as const } };
    const review = await recordFounderDecision(deps, { jobId: JOB_ID, decision: 'approved' });
    expect(review).toMatchObject({ decision: 'approved', reviewer: 'founder' });
    expect(review.checks.filter((c) => c.name === 'identity')).toMatchObject([{ status: 'pass', data: { enforced: true, verified: false, waived_by: 'founder' } }]);
    expect(review.checks.find((c) => c.name === 'identity')?.detail).toMatch(/waived: a founder approved the escalation$/);
    await expect(recordFounderDecision(deps, { jobId: JOB_ID, decision: 'rejected', note: 'changed my mind' })).rejects.toThrow(/^already_approved/);

    world.repo.seedProof(makeProof({ id: '00000000-0000-4000-8000-0000000000f2', gps_lat: YC.lat + 300 / 111_320 }));
    await expect(recordFounderDecision(deps, { jobId: JOB_ID, decision: 'approved' })).rejects.toThrow(/^outside_geofence/);
    expect(await recordFounderDecision(deps, { jobId: JOB_ID, decision: 'rejected', note: 'wrong place' })).toMatchObject({ decision: 'rejected', reviewer: 'founder', proof_id: '00000000-0000-4000-8000-0000000000f2' });
  });

  it('escalate on a proof with no review yet records the escalation without recording the automated approval first', async () => {
    const { world, contract } = await fundedWorld({ vision: scorer(0.82), budget: 3000 });
    expect(await contract.escalate({ job_id: JOB_ID, proof_id: PROOF_ID, reason: 'ops wants a look' })).toEqual({ job_id: JOB_ID, status: 'escalated' });
    expect(world.fired.filter((f) => f.name === 'onProofDecision').map((f) => f.args[2])).toEqual(['escalated']);
    const review = await world.repo.getProofReview(PROOF_ID);
    expect(review).toMatchObject({ decision: 'escalated', reviewer: 'verifier-agent', confidence: 0.82 });
    expect(review?.checks.map((c) => c.name)).toEqual(['profile', 'reuse', 'completeness', 'geofence', 'time', 'identity', 'vision', 'reviewer_note']);
  });

  it('capture_payment, payout and ledger speak USD', async () => {
    const { world, contract } = await fundedWorld();
    await world.repo.upsertProofReview(approvedReview());
    expect(await contract.capture_payment({ job_id: JOB_ID })).toEqual({ job_id: JOB_ID, captured_usd: 60 });
    expect(await contract.payout({ job_id: JOB_ID })).toEqual({ job_id: JOB_ID, status: 'paid', worker_pay_usd: 45, fee_usd: 15 });
    expect(await contract.ledger({})).toEqual({ revenue_usd: 60, payouts_usd: 45, fees_usd: 15, costs_usd: 0, jobs_paid: 1 });
    expect(await contract.refund({ job_id: JOB_ID, reason: 'customer unhappy', request_id: 'req-t' })).toMatchObject({ job_id: JOB_ID, status: 'refunded', amount_usd: 60, refunded_total_usd: 60 });
  });

  it('refund supports a partial amount and rejects over $150 with RequiresApprovalError', async () => {
    const { world, contract } = await fundedWorld();
    await world.repo.upsertProofReview(approvedReview());
    await contract.capture_payment({ job_id: JOB_ID });
    expect(await contract.refund({ job_id: JOB_ID, reason: 'partial credit', request_id: 'req-t', amount_cents: 2000 })).toEqual({
      job_id: JOB_ID,
      status: 'refunded',
      amount_usd: 20,
      partial: true,
      refunded_total_usd: 20,
    });

    const big = await fundedWorld({ budget: 24000 });
    await big.world.repo.upsertProofReview(approvedReview());
    await big.contract.capture_payment({ job_id: JOB_ID });
    await expect(big.contract.refund({ job_id: JOB_ID, reason: 'too big', request_id: 'req-t' })).rejects.toBeInstanceOf(RequiresApprovalError);
    expect(big.world.stripe.callsTo('refunds.create')).toHaveLength(0);
  });

  it('payout reports needs_bank_setup with the onboarding link, and over_limit above $150', async () => {
    const noAccount = await fundedWorld({ account: 'none' });
    await noAccount.world.repo.upsertProofReview(approvedReview());
    await noAccount.contract.capture_payment({ job_id: JOB_ID });
    const out = await noAccount.contract.payout({ job_id: JOB_ID });
    expect(out).toMatchObject({ error: 'needs_bank_setup' });
    expect((out as { onboarding_url: string }).onboarding_url).toMatch(/^https:\/\/connect\.stripe\.test\//);

    const big = await fundedWorld({ budget: 24000 });
    await big.world.repo.upsertProofReview(approvedReview());
    await big.contract.capture_payment({ job_id: JOB_ID });
    expect(await big.contract.payout({ job_id: JOB_ID })).toEqual({ error: 'over_limit' });
  });
});

describe('over-cap adapters for the CEO agent (contracts/tools.ts refund_large, release_payout_large)', () => {
  it('refund_large refunds past the $150 cap, partially, and a retry with the same request id does not refund twice', async () => {
    const big = await fundedWorld({ budget: 24000 });
    await big.world.repo.upsertProofReview(approvedReview());
    await big.contract.capture_payment({ job_id: JOB_ID });
    const input = { job_id: JOB_ID, reason: 'item damaged on site', amount_cents: 20000, request_id: 'req-large-1', approved_by: 'operis-ceo', approval_note: 'photos show the damage' };
    expect(await big.contract.refund_large(input)).toEqual({ job_id: JOB_ID, status: 'refunded', amount_usd: 200, partial: true, refunded_total_usd: 200 });
    await big.contract.refund_large(input);
    expect(big.world.stripe.callsTo('refunds.create')).toHaveLength(1);
  });

  it('refund_large releases the hold instead when nothing was captured yet', async () => {
    const big = await fundedWorld({ budget: 24000 });
    expect(await big.contract.refund_large({ job_id: JOB_ID, reason: 'cancelled before any work', request_id: 'req-large-2', approved_by: 'operis-ceo' })).toEqual({
      job_id: JOB_ID,
      status: 'refunded',
      amount_usd: 240,
      refunded_total_usd: 240,
      released_hold: true,
    });
    expect(big.world.stripe.callsTo('refunds.create')).toHaveLength(0);
  });

  it('release_payout_large pays a worker past the cap that payout refuses with over_limit', async () => {
    const big = await fundedWorld({ budget: 24000 });
    await big.world.repo.upsertProofReview(approvedReview());
    await big.contract.capture_payment({ job_id: JOB_ID });
    expect(await big.contract.payout({ job_id: JOB_ID })).toEqual({ error: 'over_limit' });
    expect(await big.contract.release_payout_large({ job_id: JOB_ID, approved_by: 'operis-ceo', approval_note: 'large job, proof approved' })).toEqual({
      job_id: JOB_ID,
      status: 'paid',
      worker_pay_usd: 180,
      fee_usd: 60,
    });
  });

  it('release_payout_large reports needs_bank_setup when the worker has no payout account', async () => {
    const big = await fundedWorld({ budget: 24000, account: 'none' });
    await big.world.repo.upsertProofReview(approvedReview());
    await big.contract.capture_payment({ job_id: JOB_ID });
    const out = await big.contract.release_payout_large({ job_id: JOB_ID, approved_by: 'operis-ceo' });
    expect(out).toMatchObject({ error: 'needs_bank_setup' });
    expect((out as { onboarding_url: string }).onboarding_url).toMatch(/^https:\/\/connect\.stripe\.test\//);
  });
});
