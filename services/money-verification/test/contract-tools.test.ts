import { describe, expect, it } from 'vitest';
import { createContractTools } from '../src/contract-tools.js';
import type { VisionScorer } from '../src/proof/vision.js';
import { createTools } from '../src/tools.js';
import { handleStripeWebhook } from '../src/webhooks/stripe.js';
import { JOB_ID, PROOF_ID, WORKER_ID, YC, approvedReview, makeJob, makeProof, makeWorker, makeWorld, webhookRequest } from './helpers.js';

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

  it('capture_payment, payout and ledger speak USD', async () => {
    const { world, contract } = await fundedWorld();
    await world.repo.upsertProofReview(approvedReview());
    expect(await contract.capture_payment({ job_id: JOB_ID })).toEqual({ job_id: JOB_ID, captured_usd: 60 });
    expect(await contract.payout({ job_id: JOB_ID })).toEqual({ job_id: JOB_ID, status: 'paid', worker_pay_usd: 45, fee_usd: 15 });
    expect(await contract.ledger({})).toEqual({ revenue_usd: 60, payouts_usd: 45, fees_usd: 15, costs_usd: 0, jobs_paid: 1 });
    expect(await contract.refund({ job_id: JOB_ID, reason: 'customer unhappy' })).toEqual({ job_id: JOB_ID, status: 'refunded', amount_usd: 60 });
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
