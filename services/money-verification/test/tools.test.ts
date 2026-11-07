import { describe, expect, it } from 'vitest';
import { handleStripeWebhook } from '../src/webhooks/stripe.js';
import { callTool, createTools, describeToolError, resolveToolName, TOOL_NAMES, toolSchemas } from '../src/tools.js';
import type { VisionScorer } from '../src/proof/vision.js';
import { JOB_ID, PROOF_ID, WORKER_ID, approvedReview, makeJob, makeProof, makeWorker, makeWorld, webhookRequest } from './helpers.js';

const passingScorer: VisionScorer = {
  async score(input) {
    return { confidence: 0.95, mustShowFound: Object.fromEntries(input.mustShow.map((m) => [m, true])), notes: 'ok' };
  },
};

function worldWithTools(opts: { vision?: VisionScorer | null } = {}) {
  const world = makeWorld();
  const tools = createTools({ ...world.deps, vision: opts.vision ?? null });
  return { world, tools };
}

describe('tool layer', () => {
  it('runs a $60 job end to end: hold -> webhook -> approve (override) -> settle -> ledger', async () => {
    const { world, tools } = worldWithTools();
    world.repo.seedJob(makeJob());
    const acct = await world.stripe.accounts.create({ type: 'express', metadata: { worker_id: WORKER_ID } });
    world.stripe.enablePayouts(acct.id);
    world.repo.seedWorker(makeWorker({ stripe_connect_account: acct.id }));
    world.repo.seedProof(makeProof());

    const held = await tools.create_escrow({ job_id: JOB_ID });
    expect(held.checkout_url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    expect(held.amount_cents).toBe(6000);
    expect(held.status).toBe('pending');

    // customer pays -> Stripe delivers checkout.session.completed
    const sessionId = (await world.repo.getEscrow(JOB_ID))?.stripe_checkout_session_id as string;
    const res = await handleStripeWebhook(world.deps, webhookRequest(world, world.stripe.completeCheckout(sessionId)));
    expect(res.status).toBe(200);
    expect(world.fired.filter((f) => f.name === 'onJobFunded')).toHaveLength(1);

    // no vision scorer -> automated review escalates; a human approves with override (the scripted 6pm path)
    await expect(tools.approve_proof({ job_id: JOB_ID, proof_id: PROOF_ID, notes: 'scripted', reviewer: 'cameron' })).rejects.toThrow(
      /^below_threshold/,
    );
    const approved = await tools.approve_proof({ job_id: JOB_ID, proof_id: PROOF_ID, notes: 'scripted', reviewer: 'cameron', override: true });
    expect(approved).toEqual({ job_id: JOB_ID, proof_id: PROOF_ID, decision: 'approved' });

    const settled = await tools.settle_job({ job_id: JOB_ID });
    expect(settled.charge_id).toMatch(/^ch_test_/);
    expect(settled.payout).toMatchObject({ status: 'paid', worker_pay_cents: 4500, fee_cents: 1500, transferred: true });

    const again = await tools.settle_job({ job_id: JOB_ID });
    expect(again.payout).toMatchObject({ status: 'paid', transferred: false });
    expect(world.stripe.callsTo('transfers.create')).toHaveLength(1);

    const pnl = await tools.ledger({});
    expect(pnl).toEqual({ fees_cents: 1500, payouts_cents: 4500, refunds_cents: 0, costs_cents: 0, gross_margin_cents: 1500, jobs_paid: 1 });

    const review = await tools.get_proof_review({ job_id: JOB_ID });
    expect(review?.decision).toBe('approved');
    expect(review?.reviewer).toBe('cameron');
  });

  it('approves automatically when the vision scorer passes, and refuses to approve the wrong job', async () => {
    const { world, tools } = worldWithTools({ vision: passingScorer });
    world.repo.seedJob(makeJob({ proof_schema: { photos: { min: 1, must_show: ['sign'] }, geofence_m: 150 } }));
    world.repo.seedWorker(makeWorker());
    world.repo.seedProof(makeProof());
    // readMedia absent -> no EXIF -> time check needs_review -> escalated even with a passing scorer
    const review = await tools.get_proof_review({ proof_id: PROOF_ID });
    expect(review).toBeNull();
    await expect(tools.approve_proof({ job_id: '00000000-0000-4000-8000-00000000ffff', proof_id: PROOF_ID, notes: 'x', override: true })).rejects.toThrow(
      /belongs to job/,
    );
    // the refusal happened before anything was recorded
    expect(await tools.get_proof_review({ proof_id: PROOF_ID })).toBeNull();
    expect(world.fired.filter((f) => f.name === 'onProofDecision')).toHaveLength(0);
  });

  it('release_payout refuses over $150 with requires_approval; release_payout_large pays', async () => {
    const { world, tools } = worldWithTools();
    const job = world.repo.seedJob(makeJob({ budget_cents: 24000 }));
    const acct = await world.stripe.accounts.create({ type: 'express' });
    world.stripe.enablePayouts(acct.id);
    world.repo.seedWorker(makeWorker({ stripe_connect_account: acct.id }));
    await world.repo.upsertProofReview(approvedReview());
    await tools.create_escrow({ job_id: job.id });
    const sessionId = (await world.repo.getEscrow(job.id))?.stripe_checkout_session_id as string;
    await handleStripeWebhook(world.deps, webhookRequest(world, world.stripe.completeCheckout(sessionId)));
    await tools.capture_escrow({ job_id: job.id });

    let caught: unknown;
    await tools.release_payout({ job_id: job.id }).catch((e: unknown) => (caught = e));
    expect(describeToolError(caught)).toMatchObject({ code: 'requires_approval' });

    const paid = await tools.release_payout_large({ job_id: job.id, approved_by: 'cameron' });
    expect(paid).toMatchObject({ status: 'paid', worker_pay_cents: 18000, fee_cents: 6000 });
  });

  it('first payout for a worker with no account returns pending_onboarding', async () => {
    const { world, tools } = worldWithTools();
    const job = world.repo.seedJob(makeJob());
    world.repo.seedWorker(makeWorker());
    await world.repo.upsertProofReview(approvedReview());
    await tools.create_escrow({ job_id: job.id });
    const sessionId = (await world.repo.getEscrow(job.id))?.stripe_checkout_session_id as string;
    await handleStripeWebhook(world.deps, webhookRequest(world, world.stripe.completeCheckout(sessionId)));
    const out = await tools.settle_job({ job_id: job.id });
    expect(out.payout).toMatchObject({ status: 'pending_onboarding', worker_pay_cents: 4500 });
    expect((out.payout as { onboarding_url: string }).onboarding_url).toMatch(/^https:\/\/connect\.stripe\.test\/onboard\//);
  });

  it('check_eligibility: suspended, tier, and notary requirement', async () => {
    const { world, tools } = worldWithTools();
    world.repo.seedJob(makeJob({ task_type: 'notarization', required_tier: 1 }));
    world.repo.seedWorker(makeWorker({ tier: 0, suspended: true }));
    const r = await tools.check_eligibility({ worker_id: WORKER_ID, job_id: JOB_ID });
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/worker_suspended/);
    expect(r.reasons.join(' ')).toMatch(/tier_too_low/);
    expect(r.reasons.join(' ')).toMatch(/notary_not_verified/);

    world.repo.seedWorker(makeWorker({ tier: 1 }));
    await world.repo.upsertWorkerVerification({
      worker_id: WORKER_ID,
      kind: 'notary_commission',
      status: 'verified',
      provider_ref: '123',
      details: {},
      verified_at: world.clock.now(),
      expires_at: new Date('2030-01-01T00:00:00Z'),
    });
    expect(await tools.check_eligibility({ worker_id: WORKER_ID, job_id: JOB_ID })).toEqual({ eligible: true, reasons: [] });
  });

  it('get_dispute and submit_dispute_evidence over a real dispute', async () => {
    const { world, tools } = worldWithTools();
    const job = world.repo.seedJob(makeJob());
    world.repo.seedWorker(makeWorker());
    await world.repo.upsertProofReview(approvedReview());
    await tools.create_escrow({ job_id: job.id });
    const sessionId = (await world.repo.getEscrow(job.id))?.stripe_checkout_session_id as string;
    await handleStripeWebhook(world.deps, webhookRequest(world, world.stripe.completeCheckout(sessionId)));
    const cap = await tools.capture_escrow({ job_id: job.id });
    const res = await handleStripeWebhook(world.deps, webhookRequest(world, world.stripe.openDispute(cap.charge_id as string, 6000)));
    expect(res.status).toBe(200);
    const disputeId = [...world.repo.disputes.keys()][0] as string;

    const bundle = await tools.get_dispute({ dispute_id: disputeId });
    expect(bundle.dispute).toMatchObject({ id: disputeId, job_id: job.id, status: 'needs_response', amount_cents: 6000 });
    expect((bundle.proof_review as { decision: string } | null)?.decision).toBe('approved');
    expect(bundle.ledger.length).toBeGreaterThan(0);

    const draft = await tools.submit_dispute_evidence({ dispute_id: disputeId, evidence: { product_description: 'inspection at YC' }, submit: false });
    expect(draft).toEqual({ dispute_id: disputeId, status: 'needs_response', submitted: false });
    const sent = await tools.submit_dispute_evidence({ dispute_id: disputeId, evidence: { uncategorized_text: 'proof attached' }, submit: true });
    expect(sent).toMatchObject({ status: 'under_review', submitted: true });
  });

  it('validates input with zod and resolves aliases', async () => {
    const { world } = worldWithTools();
    let caught: unknown;
    await callTool(world.deps, 'create_escrow', { job_id: 'not-a-uuid' }).catch((e: unknown) => (caught = e));
    expect(describeToolError(caught)).toMatchObject({ code: 'invalid_input' });
    await callTool(world.deps, 'hold_for_job', { job_id: JOB_ID }).catch((e: unknown) => (caught = e));
    expect(describeToolError(caught)).toMatchObject({ code: 'not_found' }); // alias resolved, job missing
    await callTool(world.deps, 'no_such_tool', {}).catch((e: unknown) => (caught = e));
    expect(describeToolError(caught)).toMatchObject({ code: 'not_found' });
    expect(resolveToolName('pay_worker')).toBe('release_payout');
    expect(resolveToolName('capture_payment')).toBe('capture_escrow');
    expect(TOOL_NAMES).toHaveLength(Object.keys(toolSchemas).length);
    for (const name of TOOL_NAMES) expect(toolSchemas[name].description.length).toBeGreaterThan(10);
  });
});
