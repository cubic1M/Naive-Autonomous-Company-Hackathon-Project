import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { getDisputeBundle, recordDisputeEvent, submitDisputeEvidence } from '../src/disputes.js';
import { NotFoundError } from '../src/errors.js';
import { JOB_ID, T0, approvedReview, fundAndCapture, makeJob, makeProof, makeWorld, type World } from './helpers.js';

async function captured(world: World) {
  const job = world.repo.seedJob(makeJob());
  const funded = await fundAndCapture(world, job);
  return { job, ...funded };
}
const opened = (w: World) => w.fired.filter((f) => f.name === 'onDisputeOpened');
const lossLines = (w: World) => w.repo.ledger.filter((l) => l.kind === 'dispute_loss');

describe('recordDisputeEvent', () => {
  it('created: resolves job, sets status, due date, opened_at, fires hook once', async () => {
    const world = makeWorld();
    const { chargeId, paymentIntentId } = await captured(world);
    const event = world.stripe.openDispute(chargeId, 6000);
    const row = await recordDisputeEvent(world.deps, event);
    expect(row).toMatchObject({
      job_id: JOB_ID,
      stripe_charge_id: chargeId,
      stripe_payment_intent_id: paymentIntentId,
      amount_cents: 6000,
      status: 'needs_response',
      closed_at: null,
    });
    expect(row.evidence_due_by).toEqual(new Date(T0.getTime() + 7 * 24 * 3600 * 1000));
    expect(row.opened_at).toEqual(T0);
    expect(opened(world)).toHaveLength(1);
    expect(opened(world)[0]?.args).toEqual([row.id, JOB_ID]);

    await recordDisputeEvent(world.deps, event);
    expect(opened(world)).toHaveLength(1);
  });

  it('updated: changes status and preserves stored evidence', async () => {
    const world = makeWorld();
    const { chargeId } = await captured(world);
    const created = await recordDisputeEvent(world.deps, world.stripe.openDispute(chargeId, 6000));
    await submitDisputeEvidence(world.deps, created.id, { customer_name: 'Pat' });
    const row = await recordDisputeEvent(world.deps, world.stripe.updateDisputeEvent(created.id, 'under_review'));
    expect(row.status).toBe('under_review');
    expect(row.evidence).toEqual({ customer_name: 'Pat' });
    expect(opened(world)).toHaveLength(1);
  });

  it('closed lost: exactly one dispute_loss line, stable across redelivery; closed_at set', async () => {
    const world = makeWorld();
    const { chargeId } = await captured(world);
    const created = await recordDisputeEvent(world.deps, world.stripe.openDispute(chargeId, 6000));
    const closed = world.stripe.closeDispute(created.id, 'lost');
    const row = await recordDisputeEvent(world.deps, closed);
    await recordDisputeEvent(world.deps, closed);
    expect(row.closed_at).toEqual(T0);
    expect(lossLines(world)).toHaveLength(1);
    expect(lossLines(world)[0]).toMatchObject({
      amount_cents: 6000,
      job_id: JOB_ID,
      idempotency_key: `dispute_loss:${created.id}`,
    });
  });

  it('closed won: no dispute_loss line, closed_at set', async () => {
    const world = makeWorld();
    const { chargeId } = await captured(world);
    const created = await recordDisputeEvent(world.deps, world.stripe.openDispute(chargeId, 6000));
    const row = await recordDisputeEvent(world.deps, world.stripe.closeDispute(created.id, 'won'));
    expect(row.status).toBe('won');
    expect(row.closed_at).toEqual(T0);
    expect(lossLines(world)).toHaveLength(0);
  });

  it('resolves the job through the ledger when the dispute has no payment_intent', async () => {
    const world = makeWorld();
    const { chargeId } = await captured(world);
    const event = world.stripe.event('charge.dispute.created', {
      id: 'dp_nopi',
      object: 'dispute',
      charge: chargeId,
      amount: 6000,
      currency: 'usd',
      status: 'needs_response',
      reason: 'fraudulent',
      payment_intent: null,
      evidence_details: { due_by: null },
    });
    const row = await recordDisputeEvent(world.deps, event);
    expect(row.job_id).toBe(JOB_ID);
    expect(row.stripe_payment_intent_id).toBeNull();
    expect(row.evidence_due_by).toBeNull();
  });
});

describe('getDisputeBundle', () => {
  it('returns job, escrow, review, proofs and ledger lines; null for unknown ids', async () => {
    const world = makeWorld();
    const { chargeId } = await captured(world);
    world.repo.seedProof(makeProof());
    await world.repo.upsertProofReview(approvedReview());
    const created = await recordDisputeEvent(world.deps, world.stripe.openDispute(chargeId, 6000));
    const bundle = await getDisputeBundle(world.deps, created.id);
    expect(bundle?.dispute.id).toBe(created.id);
    expect(bundle?.job?.id).toBe(JOB_ID);
    expect(bundle?.escrow?.status).toBe('captured');
    expect(bundle?.proofReview?.decision).toBe('approved');
    expect(bundle?.proofs).toHaveLength(1);
    expect(bundle?.ledger.map((l) => l.kind).sort()).toEqual(['escrow_capture', 'escrow_hold']);
    expect(await getDisputeBundle(world.deps, 'dp_missing')).toBeNull();
  });
});

describe('submitDisputeEvidence', () => {
  const evidence: Stripe.DisputeUpdateParams.Evidence = { product_description: 'On-site inspection', customer_name: 'Pat' };

  it('defaults to a draft: submit false, evidence merged, status and submitted_at unchanged', async () => {
    const world = makeWorld();
    const { chargeId } = await captured(world);
    const created = await recordDisputeEvent(world.deps, world.stripe.openDispute(chargeId, 6000));
    const row = await submitDisputeEvidence(world.deps, created.id, evidence);
    const call = world.stripe.callsTo('disputes.update')[0];
    expect(call?.params).toEqual({ id: created.id, params: { evidence, submit: false } });
    expect(call?.idempotencyKey).toBeUndefined();
    expect(row.evidence).toEqual(evidence);
    expect(row.status).toBe('needs_response');
    expect(row.evidence_submitted_at).toBeNull();
  });

  it('submit: true sets under_review and evidence_submitted_at', async () => {
    const world = makeWorld();
    const { chargeId } = await captured(world);
    const created = await recordDisputeEvent(world.deps, world.stripe.openDispute(chargeId, 6000));
    await submitDisputeEvidence(world.deps, created.id, { customer_name: 'Pat' });
    const row = await submitDisputeEvidence(world.deps, created.id, { product_description: 'x' }, { submit: true });
    expect(world.stripe.callsTo('disputes.update')[1]?.params).toMatchObject({ params: { submit: true } });
    expect(row.status).toBe('under_review');
    expect(row.evidence_submitted_at).toEqual(T0);
    expect(row.evidence).toEqual({ customer_name: 'Pat', product_description: 'x' });
  });

  it('throws NotFoundError for an unknown dispute and never calls Stripe', async () => {
    const world = makeWorld();
    await expect(submitDisputeEvidence(world.deps, 'dp_missing', evidence)).rejects.toBeInstanceOf(NotFoundError);
    expect(world.stripe.callsTo('disputes.update')).toHaveLength(0);
  });
});
