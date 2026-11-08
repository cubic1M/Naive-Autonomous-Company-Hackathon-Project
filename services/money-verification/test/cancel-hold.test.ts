// services/money-verification/test/cancel-hold.test.ts
// Releasing the card hold when a funded job is cancelled (customer cancel_job, the sweep's overdue cancel, a liability
// refusal): the function services/payments exports as releaseCancelledHold.
import { describe, expect, it } from 'vitest';
import { createEscrow, markAuthorized, releaseCancelledJobHold } from '../src/escrow.js';
import type { Job } from '../src/types.js';
import { JOB_ID, makeJob, makeWorld, type World } from './helpers.js';

/** createEscrow -> customer pays -> markAuthorized: an authorized hold, as a funded (held) job has. */
async function authorize(world: World, job: Job): Promise<string> {
  const { escrow } = await createEscrow(world.deps, job);
  const sessionId = escrow.stripe_checkout_session_id;
  if (!sessionId) throw new Error('no session');
  world.stripe.completeCheckout(sessionId);
  const piId = world.stripe.csStore.get(sessionId)?.payment_intent;
  if (!piId) throw new Error('no payment intent');
  await markAuthorized(world.deps, job.id, piId);
  return piId;
}

describe('releaseCancelledJobHold', () => {
  it('releases the authorized hold of a cancelled job, once: the PaymentIntent is canceled', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob({ status: 'held', worker_id: null }));
    const piId = await authorize(world, job);
    world.repo.seedJob({ ...job, status: 'cancelled' });
    expect(await releaseCancelledJobHold(world.deps, JOB_ID, 'customer cancelled')).toEqual({ released: true, escrowStatus: 'released' });
    expect(world.stripe.piStore.get(piId)?.status).toBe('canceled');
    expect((await world.repo.getLedgerByKey(`escrow_release:${JOB_ID}`))?.kind).toBe('escrow_release');
    expect(await releaseCancelledJobHold(world.deps, JOB_ID)).toEqual({ released: false, escrowStatus: 'released', skipped: 'not_open' });
    expect(world.stripe.callsTo('paymentIntents.cancel')).toHaveLength(1);
  });
  it('releases a pending hold (Checkout not paid yet) and cancels its PaymentIntent, so the link cannot be paid later', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob({ status: 'requested', worker_id: null }));
    const { escrow } = await createEscrow(world.deps, job);
    expect(escrow.status).toBe('pending');
    world.repo.seedJob({ ...job, status: 'cancelled' });
    expect(await releaseCancelledJobHold(world.deps, JOB_ID)).toEqual({ released: true, escrowStatus: 'released' });
    const piId = escrow.stripe_payment_intent_id;
    expect(piId).toBeTruthy();
    expect(world.stripe.piStore.get(piId as string)?.status).toBe('canceled');
  });
  it('leaves the hold of a job that is not cancelled alone', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob({ status: 'held', worker_id: null }));
    const piId = await authorize(world, job);
    expect(await releaseCancelledJobHold(world.deps, JOB_ID)).toEqual({ released: false, escrowStatus: 'authorized', skipped: 'job_not_cancelled' });
    expect(world.stripe.piStore.get(piId)?.status).toBe('requires_capture');
  });
  it('does nothing for a cancelled job with no escrow (MOCK_PAYMENTS jobs)', async () => {
    const world = makeWorld();
    world.repo.seedJob(makeJob({ status: 'cancelled', worker_id: null }));
    expect(await releaseCancelledJobHold(world.deps, JOB_ID)).toEqual({ released: false, escrowStatus: null, skipped: 'no_escrow' });
  });
});
