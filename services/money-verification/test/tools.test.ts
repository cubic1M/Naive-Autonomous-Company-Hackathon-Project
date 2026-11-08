import { describe, expect, it } from 'vitest';
import { handleStripeWebhook } from '../src/webhooks/stripe.js';
import { callTool, createTools, describeToolError, resolveToolName, TOOL_NAMES, toolSchemas } from '../src/tools.js';
import type { VisionScorer } from '../src/proof/vision.js';
import { CUSTOMER_ID, JOB_ID, PROOF_ID, WORKER_ID, approvedReview, makeJob, makeProof, makeWorker, makeWorld, seedVerifiedIdentity, webhookRequest } from './helpers.js';

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
  it('describeToolError maps Stripe idempotency_error to an actionable code', () => {
    const err = Object.assign(new Error('Keys for idempotent requests can only be used with the same parameters'), { rawType: 'idempotency_error' });
    expect(describeToolError(err)).toMatchObject({ code: 'idempotency_conflict' });
  });

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

  it('refund: partial via amount_cents, requires_approval over the cap, refund_large with approved_by', async () => {
    const { world, tools } = worldWithTools();
    const job = world.repo.seedJob(makeJob({ budget_cents: 24000 }));
    await tools.create_escrow({ job_id: job.id });
    const sessionId = (await world.repo.getEscrow(job.id))?.stripe_checkout_session_id as string;
    await handleStripeWebhook(world.deps, webhookRequest(world, world.stripe.completeCheckout(sessionId)));
    await tools.capture_escrow({ job_id: job.id });

    const partial = await tools.refund({ job_id: job.id, reason: 'partial credit', request_id: 'req-t', amount_cents: 2000 });
    expect(partial).toEqual({ job_id: job.id, status: 'partially_refunded', amount_cents: 2000, refunded_total_cents: 2000 });

    let caught: unknown;
    await tools.refund({ job_id: job.id, reason: 'the rest', request_id: 'req-rest' }).catch((e: unknown) => (caught = e));
    expect(describeToolError(caught)).toMatchObject({ code: 'requires_approval' });

    const rest = await tools.refund_large({ job_id: job.id, reason: 'the rest', request_id: 'req-rest', approved_by: 'ceo-agent' });
    expect(rest).toEqual({ job_id: job.id, status: 'refunded', amount_cents: 22000, refunded_total_cents: 24000 });
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

  it('check_eligibility: suspended, tier, notary requirement, and the tier-2 identity', async () => {
    const { world, tools } = worldWithTools();
    world.repo.seedJob(makeJob({ task_type: 'notarization', required_tier: 1 }));
    world.repo.seedWorker(makeWorker({ tier: 0, suspended: true }));
    const r = await tools.check_eligibility({ worker_id: WORKER_ID, job_id: JOB_ID });
    expect(r.eligible).toBe(false);
    expect(r.tier).toBe(2); // a notarization job is tier 2 whatever its budget
    expect(r.reasons.join(' ')).toMatch(/worker_suspended/);
    expect(r.reasons.join(' ')).toMatch(/tier_too_low/);
    expect(r.reasons.join(' ')).toMatch(/notary_not_verified/);
    expect(r.reasons.join(' ')).toMatch(/identity_not_verified/);

    world.repo.seedWorker(makeWorker({ tier: 1 }));
    await seedVerifiedIdentity(world);
    await world.repo.upsertWorkerVerification({
      worker_id: WORKER_ID,
      kind: 'notary_commission',
      status: 'verified',
      provider_ref: '123',
      details: {},
      verified_at: world.clock.now(),
      expires_at: new Date('2030-01-01T00:00:00Z'),
    });
    expect(await tools.check_eligibility({ worker_id: WORKER_ID, job_id: JOB_ID })).toEqual({ eligible: true, reasons: [], tier: 2 });
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

  it('verify_identity starts a Stripe Identity session and reports verified after the webhook', async () => {
    const { world, tools } = worldWithTools();
    world.repo.seedWorker(makeWorker());
    const start = await tools.verify_identity({ worker_id: WORKER_ID });
    expect(start).toEqual({
      worker_id: WORKER_ID,
      url: expect.stringMatching(/^https:\/\/verify\.stripe\.test\//),
      status: 'pending',
      session_id: expect.stringMatching(/^vs_test_/),
    });
    const event = world.stripe.identityVerifiedEvent(start.session_id as string, { first_name: 'Pat', last_name: 'Example' });
    expect((await handleStripeWebhook(world.deps, webhookRequest(world, event))).status).toBe(200);
    expect(await tools.verify_identity({ worker_id: WORKER_ID })).toEqual({ worker_id: WORKER_ID, url: null, status: 'verified', session_id: start.session_id });
    expect(world.stripe.callsTo('identity.verificationSessions.create')).toHaveLength(1);

    let caught: unknown;
    await callTool(world.deps, 'verify_identity', { worker_id: 'not-a-uuid' }).catch((e: unknown) => (caught = e));
    expect(describeToolError(caught)).toMatchObject({ code: 'invalid_input' });
  });

  it('verify_notary reports which name it compared', async () => {
    const { world, tools } = worldWithTools();
    await world.repo.upsertNotary({
      commission_number: '2301234', full_name: 'SMITH, JANE A', name_normalized: 'jane a smith',
      county: null, city: null, business_name: null, commission_expires: new Date('2028-03-15T00:00:00Z'), raw: {},
    });
    const typed = await tools.verify_notary({ worker_id: WORKER_ID, commission_number: '2301234', name: 'Jane Smith', job_date: '2026-11-07T18:00:00Z' });
    expect(typed).toMatchObject({ worker_id: WORKER_ID, status: 'verified', name_source: 'typed', reasons: [] });
    await seedVerifiedIdentity(world, { firstName: 'Mary', lastName: 'Jones' });
    const byId = await tools.verify_notary({ worker_id: WORKER_ID, commission_number: '2301234', name: 'Jane Smith', job_date: '2026-11-07T18:00:00Z' });
    expect(byId).toMatchObject({ status: 'failed', name_source: 'verified_identity' });
    expect(byId.reasons[0]).toBe('name_mismatch');
  });

  it('get_proof_review carries each check\'s data, so the tier is readable', async () => {
    const { world, tools } = worldWithTools({ vision: passingScorer });
    world.repo.seedJob(makeJob({ budget_cents: 3000 }));
    world.repo.seedWorker(makeWorker());
    world.repo.seedProof(makeProof());
    // tier 0, no readMedia: device GPS and captured_at carry the deterministic checks, the scorer passes 0.95 >= 0.8
    expect(await tools.approve_proof({ job_id: JOB_ID, proof_id: PROOF_ID, notes: 'tier 0 on device data' })).toMatchObject({ decision: 'approved' });
    const review = await tools.get_proof_review({ job_id: JOB_ID });
    expect(review?.checks.find((c) => c.name === 'profile')?.data).toMatchObject({ tier: 0, confidence_threshold: 0.8 });
    expect(review?.checks.find((c) => c.name === 'geofence')?.data).toMatchObject({ distance_m: 0 });
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

describe('create_escrow with a card on file', () => {
  it('funds the job directly: checkout_url null, status authorized, funded true, onJobFunded fired', async () => {
    const { world, tools } = worldWithTools();
    world.repo.seedJob(makeJob({ status: 'requested' }));
    world.repo.seedCustomer({ customer_id: CUSTOMER_ID, name: null, email: null, stripe_customer_id: 'cus_acme', default_payment_method_id: 'pm_saved_acme' });
    const held = await tools.create_escrow({ job_id: JOB_ID });
    expect(held).toEqual({ job_id: JOB_ID, checkout_url: null, amount_cents: 6000, status: 'authorized', funded: true });
    expect(toolSchemas.create_escrow.output.parse(held)).toEqual(held);
    expect(world.fired.filter((f) => f.name === 'onJobFunded')).toHaveLength(1);
  });

  it('without one, the Checkout answer carries funded false and still validates', async () => {
    const { world, tools } = worldWithTools();
    world.repo.seedJob(makeJob({ status: 'requested' }));
    const held = await tools.create_escrow({ job_id: JOB_ID });
    expect(held).toMatchObject({ status: 'pending', funded: false });
    expect(held.checkout_url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    expect(toolSchemas.create_escrow.output.parse(held)).toEqual(held);
  });
});
