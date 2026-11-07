import { describe, expect, it } from 'vitest';
import { AUTHORIZATION_TTL_MS, createEscrow } from '../src/escrow.js';
import { handleStripeWebhook, createStripeWebhookHandler } from '../src/webhooks/stripe.js';
import {
  JOB_ID,
  T0,
  WORKER_ID,
  approvedReview,
  fundAndCapture,
  makeJob,
  makeWorker,
  makeWorld,
  webhookRequest,
  type World,
} from './helpers.js';

const firedNamed = (w: World, name: string) => w.fired.filter((f) => f.name === name);

/** Seed a job and a pending escrow; returns the Checkout session id. */
async function pendingEscrow(world: World) {
  const job = world.repo.seedJob(makeJob());
  const { escrow } = await createEscrow(world.deps, job);
  const sessionId = escrow.stripe_checkout_session_id ?? '';
  return { job, sessionId };
}

describe('signature handling', () => {
  it('rejects a corrupted signature with 400 and changes nothing', async () => {
    const world = makeWorld();
    const { sessionId } = await pendingEscrow(world);
    const event = world.stripe.completeCheckout(sessionId);
    const res = await handleStripeWebhook(world.deps, webhookRequest(world, event, { badSignature: true }));
    expect(res.status).toBe(400);
    expect(world.repo.stripeEvents.size).toBe(0);
    expect((await world.repo.getEscrow(JOB_ID))?.status).toBe('pending');
    expect(world.fired).toHaveLength(0);
  });

  it('rejects a missing stripe-signature header with 400', async () => {
    const world = makeWorld();
    const req = new Request('https://operis.test/webhooks/stripe', { method: 'POST', body: '{}' });
    expect((await handleStripeWebhook(world.deps, req)).status).toBe(400);
  });

  it('rejects a body signed with the wrong secret, without echoing secrets', async () => {
    const world = makeWorld();
    const event = world.stripe.event('ping', { id: 'x' });
    const res = await handleStripeWebhook(world.deps, webhookRequest(world, event, { secret: 'whsec_other' }));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain('whsec_');
  });
});

describe('checkout.session.completed', () => {
  it('authorizes the escrow, stamps expiry, fires onJobFunded once and marks the event', async () => {
    const world = makeWorld();
    const { sessionId } = await pendingEscrow(world);
    const event = world.stripe.completeCheckout(sessionId);
    const res = await handleStripeWebhook(world.deps, webhookRequest(world, event));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, type: 'checkout.session.completed', duplicate: false, handled: true });
    const escrow = await world.repo.getEscrow(JOB_ID);
    expect(escrow?.status).toBe('authorized');
    expect(escrow?.stripe_payment_intent_id).toBe(world.stripe.csStore.get(sessionId)?.payment_intent);
    expect(escrow?.authorization_expires_at).toEqual(new Date(T0.getTime() + AUTHORIZATION_TTL_MS));
    const funded = firedNamed(world, 'onJobFunded');
    expect(funded).toHaveLength(1);
    expect(funded[0]?.args).toEqual([JOB_ID]);
    expect(world.repo.stripeEvents.has(event.id)).toBe(true);
  });

  it('duplicate delivery of the same event does nothing the second time', async () => {
    const world = makeWorld();
    const { sessionId } = await pendingEscrow(world);
    const event = world.stripe.completeCheckout(sessionId);
    await handleStripeWebhook(world.deps, webhookRequest(world, event));
    const res2 = await handleStripeWebhook(world.deps, webhookRequest(world, event));
    expect(res2.status).toBe(200);
    expect(await res2.json()).toMatchObject({ received: true, duplicate: true });
    expect(firedNamed(world, 'onJobFunded')).toHaveLength(1);
    expect(world.repo.stripeEvents.size).toBe(1);
  });

  it('a handler failure returns 500, does NOT mark the event, and the retry is processed again', async () => {
    const world = makeWorld();
    // metadata.job_id points at a job that has no escrow: markAuthorized throws NotFoundError.
    const session = {
      id: 'cs_orphan',
      object: 'checkout.session',
      mode: 'payment',
      payment_intent: 'pi_orphan',
      metadata: { job_id: 'job-without-escrow' },
      payment_status: 'unpaid',
    };
    const event = world.stripe.event('checkout.session.completed', session);
    const res = await handleStripeWebhook(world.deps, webhookRequest(world, event));
    expect(res.status).toBe(500);
    expect(world.repo.stripeEvents.has(event.id)).toBe(false);
    const retry = await handleStripeWebhook(world.deps, webhookRequest(world, event));
    expect(retry.status).toBe(500);
    expect(await retry.json()).not.toHaveProperty('duplicate', true);
  });

  it('ignores non-payment sessions', async () => {
    const world = makeWorld();
    const event = world.stripe.event('checkout.session.completed', { id: 'cs_x', mode: 'setup', metadata: {} });
    const res = await handleStripeWebhook(world.deps, webhookRequest(world, event));
    expect(await res.json()).toMatchObject({ handled: false });
  });
});

describe('payment_intent.canceled', () => {
  it('releases the escrow, writes one escrow_release line and fires onEscrowReleased', async () => {
    const world = makeWorld();
    const { sessionId } = await pendingEscrow(world);
    await handleStripeWebhook(world.deps, webhookRequest(world, world.stripe.completeCheckout(sessionId)));
    const piId = world.stripe.csStore.get(sessionId)?.payment_intent ?? '';
    const res = await handleStripeWebhook(world.deps, webhookRequest(world, world.stripe.paymentIntentCanceledEvent(piId)));
    expect(res.status).toBe(200);
    expect((await world.repo.getEscrow(JOB_ID))?.status).toBe('released');
    expect(world.repo.ledger.filter((l) => l.kind === 'escrow_release')).toHaveLength(1);
    expect(firedNamed(world, 'onEscrowReleased')[0]?.args).toEqual([JOB_ID, 'released']);
  });
});

describe('charge.refunded', () => {
  it('marks the escrow refunded and writes a 6000 refund line', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    const { paymentIntentId } = await fundAndCapture(world, job);
    const res = await handleStripeWebhook(world.deps, webhookRequest(world, world.stripe.chargeRefundedEvent(paymentIntentId)));
    expect(res.status).toBe(200);
    expect((await world.repo.getEscrow(JOB_ID))?.status).toBe('refunded');
    expect(world.repo.ledger.filter((l) => l.kind === 'refund').map((l) => l.amount_cents)).toEqual([6000]);
  });
});

describe('account.updated', () => {
  async function workerWithAccount(world: World) {
    const acct = await world.stripe.accounts.create({ type: 'express', metadata: { worker_id: WORKER_ID } });
    world.repo.seedWorker(makeWorker({ stripe_connect_account: acct.id }));
    return acct.id;
  }

  it('fires onWorkerPayoutReady and completes a pending_onboarding payout into a transfer', async () => {
    const world = makeWorld();
    const accountId = await workerWithAccount(world);
    const job = world.repo.seedJob(makeJob());
    await world.repo.upsertProofReview(approvedReview());
    await fundAndCapture(world, job);
    await world.repo.upsertPayout({
      job_id: JOB_ID,
      worker_id: WORKER_ID,
      amount_cents: 4500,
      status: 'pending_onboarding',
      stripe_transfer_id: null,
      stripe_connect_account: accountId,
      onboarding_url: 'https://connect.stripe.test/onboard',
    });

    const res = await handleStripeWebhook(world.deps, webhookRequest(world, world.stripe.enablePayouts(accountId)));

    expect(res.status).toBe(200);
    expect(firedNamed(world, 'onWorkerPayoutReady')[0]?.args).toEqual([WORKER_ID]);
    expect(world.stripe.callsTo('transfers.create')).toHaveLength(1);
    expect(world.repo.payouts.get(JOB_ID)).toMatchObject({ status: 'paid' });
    expect(world.repo.payouts.get(JOB_ID)?.stripe_transfer_id).toMatch(/^tr_test_/);
  });

  it('does nothing when payouts are not enabled', async () => {
    const world = makeWorld();
    const accountId = await workerWithAccount(world);
    const acct = world.stripe.acctStore.get(accountId);
    const event = world.stripe.event('account.updated', acct);
    const res = await handleStripeWebhook(world.deps, webhookRequest(world, event));
    expect(await res.json()).toMatchObject({ handled: false });
    expect(firedNamed(world, 'onWorkerPayoutReady')).toHaveLength(0);
  });
});

describe('other events', () => {
  it('unknown types return 200, handled false, and are marked', async () => {
    const world = makeWorld();
    const event = world.stripe.event('customer.created', { id: 'cus_1' });
    const res = await handleStripeWebhook(world.deps, webhookRequest(world, event));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ handled: false, duplicate: false });
    expect(world.repo.stripeEvents.has(event.id)).toBe(true);
  });

  it('charge.dispute.created creates a disputes row and fires onDisputeOpened', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    const { chargeId } = await fundAndCapture(world, job);
    const event = world.stripe.openDispute(chargeId, 6000);
    const res = await createStripeWebhookHandler(world.deps)(webhookRequest(world, event));
    expect(res.status).toBe(200);
    const row = [...world.repo.disputes.values()][0];
    expect(row).toMatchObject({ job_id: JOB_ID, stripe_charge_id: chargeId, status: 'needs_response' });
    expect(firedNamed(world, 'onDisputeOpened')[0]?.args).toEqual([row?.id, JOB_ID]);
  });
});
