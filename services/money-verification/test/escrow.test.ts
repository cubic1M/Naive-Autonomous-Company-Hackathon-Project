import { describe, expect, it } from 'vitest';
import {
  AUTHORIZATION_TTL_MS,
  captureEscrow,
  createEscrow,
  escrowAmountCents,
  expireStaleEscrows,
  markAuthorized,
  markRefunded,
  markReleased,
  refund,
  releaseEscrow,
} from '../src/escrow.js';
import { DailyCapExceededError, InvalidStateError } from '../src/errors.js';
import type { Job } from '../src/types.js';
import { HOUR_MS, JOB_ID, MINUTE_MS, T0, fundAndCapture, makeJob, makeWorld, type World } from './helpers.js';

const DAY_MS = 24 * HOUR_MS;
const JOB_B = '00000000-0000-4000-8000-0000000000b2';

interface CheckoutParams {
  mode: string;
  line_items: { quantity: number; price_data: { unit_amount: number } }[];
  payment_intent_data: { capture_method: string; transfer_group: string; metadata: { job_id: string } };
  metadata: { job_id: string };
  success_url: string;
  cancel_url: string;
}

/** createEscrow -> customer pays -> markAuthorized. Returns the payment intent id. */
async function createAndAuthorize(world: World, job: Job): Promise<string> {
  const { escrow } = await createEscrow(world.deps, job);
  const sessionId = escrow.stripe_checkout_session_id;
  if (!sessionId) throw new Error('no session');
  world.stripe.completeCheckout(sessionId);
  const piId = world.stripe.csStore.get(sessionId)?.payment_intent;
  if (!piId) throw new Error('no payment intent');
  await markAuthorized(world.deps, job.id, piId);
  return piId;
}

const releasedHooks = (world: World) => world.fired.filter((f) => f.name === 'onEscrowReleased');

describe('createEscrow', () => {
  it('opens a manual-capture Checkout session and writes the pending escrow + escrow_hold line', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    const { url, escrow } = await createEscrow(world.deps, job);

    const calls = world.stripe.callsTo('checkout.sessions.create');
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error('missing call');
    const p = call.params as CheckoutParams;
    expect(p.mode).toBe('payment');
    expect(p.payment_intent_data.capture_method).toBe('manual');
    expect(p.payment_intent_data.transfer_group).toBe(`job:${JOB_ID}`);
    expect(p.metadata.job_id).toBe(JOB_ID);
    expect(p.payment_intent_data.metadata.job_id).toBe(JOB_ID);
    expect(p.line_items).toHaveLength(1);
    expect(p.line_items[0]?.price_data.unit_amount).toBe(6000);
    expect(p.success_url.startsWith(`${world.env.PUBLIC_BASE_URL}/jobs/${JOB_ID}/funded`)).toBe(true);
    expect(p.cancel_url).toContain('/cancelled');
    expect(call.idempotencyKey).toBe(`escrow:${JOB_ID}`);

    const row = await world.repo.getEscrow(JOB_ID);
    expect(row?.status).toBe('pending');
    expect(row?.amount_cents).toBe(6000);
    const sessionId = [...world.stripe.csStore.keys()][0];
    expect(row?.stripe_checkout_session_id).toBe(sessionId);
    expect(escrow.job_id).toBe(JOB_ID);

    expect(world.repo.ledger).toHaveLength(1);
    const line = world.repo.ledger[0];
    expect(line?.kind).toBe('escrow_hold');
    expect(line?.amount_cents).toBe(6000);
    expect(line?.idempotency_key).toBe(`escrow_hold:${JOB_ID}`);

    expect(url).toBe(world.stripe.csStore.get(sessionId ?? '')?.url);
  });

  it('is idempotent for a still-pending job', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    const a = await createEscrow(world.deps, job);
    const b = await createEscrow(world.deps, job);
    expect(b.escrow.stripe_checkout_session_id).toBe(a.escrow.stripe_checkout_session_id);
    expect(b.url).toBe(a.url);
    expect(world.repo.escrows.size).toBe(1);
    expect(world.repo.ledger.filter((l) => l.kind === 'escrow_hold')).toHaveLength(1);
  });

  it('throws InvalidStateError when the escrow is already authorized', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    await createAndAuthorize(world, job);
    await expect(createEscrow(world.deps, job)).rejects.toBeInstanceOf(InvalidStateError);
  });

  describe('daily cap', () => {
    it('rejects a hold that would exceed the rolling 24h cap, then allows it once the window passes', async () => {
      const world = makeWorld();
      const jobA = world.repo.seedJob(makeJob({ budget_cents: 150_000 }));
      const jobB = world.repo.seedJob(makeJob({ id: JOB_B, budget_cents: 60_000 }));

      await createEscrow(world.deps, jobA);
      expect(world.stripe.callsTo('checkout.sessions.create')).toHaveLength(1);

      await expect(createEscrow(world.deps, jobB)).rejects.toBeInstanceOf(DailyCapExceededError);
      expect(world.stripe.callsTo('checkout.sessions.create')).toHaveLength(1);
      expect(await world.repo.getEscrow(JOB_B)).toBeNull();

      world.clock.advance(DAY_MS + 1000);
      await createEscrow(world.deps, jobB);
      expect(world.stripe.callsTo('checkout.sessions.create')).toHaveLength(2);
      expect((await world.repo.getEscrow(JOB_B))?.status).toBe('pending');
    });

    it('rejects once at least 1ms has passed since the earlier hold (isolates the same-instant edge)', async () => {
      const world = makeWorld();
      const jobA = world.repo.seedJob(makeJob({ budget_cents: 150_000 }));
      const jobB = world.repo.seedJob(makeJob({ id: JOB_B, budget_cents: 60_000 }));
      await createEscrow(world.deps, jobA);
      world.clock.advance(1);
      await expect(createEscrow(world.deps, jobB)).rejects.toBeInstanceOf(DailyCapExceededError);
      expect(world.stripe.callsTo('checkout.sessions.create')).toHaveLength(1);
      world.clock.advance(DAY_MS + 1000);
      await createEscrow(world.deps, jobB);
      expect(world.stripe.callsTo('checkout.sessions.create')).toHaveLength(2);
    });

    it('still rejects just inside the 24h window', async () => {
      const world = makeWorld();
      const jobA = world.repo.seedJob(makeJob({ budget_cents: 150_000 }));
      const jobB = world.repo.seedJob(makeJob({ id: JOB_B, budget_cents: 60_000 }));
      await createEscrow(world.deps, jobA);
      world.clock.advance(DAY_MS - 1000);
      await expect(createEscrow(world.deps, jobB)).rejects.toBeInstanceOf(DailyCapExceededError);
    });
  });
});

describe('escrowAmountCents', () => {
  it('is worker pay plus fee', () => {
    expect(escrowAmountCents(makeJob())).toBe(6000);
    expect(escrowAmountCents(makeJob({ worker_pay_cents: 1234, fee_cents: 56 }))).toBe(1290);
  });

  it('throws InvalidStateError when both are zero', () => {
    expect(() => escrowAmountCents(makeJob({ worker_pay_cents: 0, fee_cents: 0 }))).toThrow(InvalidStateError);
  });

  it('createEscrow surfaces it before any Stripe call', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob({ worker_pay_cents: 0, fee_cents: 0 }));
    await expect(createEscrow(world.deps, job)).rejects.toBeInstanceOf(InvalidStateError);
    expect(world.stripe.calls).toHaveLength(0);
  });
});

describe('markAuthorized', () => {
  it('moves pending to authorized with a 7-day expiry, and is a no-op the second time', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    const { escrow } = await createEscrow(world.deps, job);
    const sessionId = escrow.stripe_checkout_session_id ?? '';
    world.stripe.completeCheckout(sessionId);
    const piId = world.stripe.csStore.get(sessionId)?.payment_intent ?? '';

    const first = await markAuthorized(world.deps, JOB_ID, piId);
    expect(first.status).toBe('authorized');
    expect(first.stripe_payment_intent_id).toBe(piId);
    expect(first.authorization_expires_at?.getTime()).toBe(T0.getTime() + AUTHORIZATION_TTL_MS);
    expect(AUTHORIZATION_TTL_MS).toBe(7 * DAY_MS);

    world.clock.advance(HOUR_MS);
    const second = await markAuthorized(world.deps, JOB_ID, 'pi_other');
    expect(second.status).toBe('authorized');
    expect(second.stripe_payment_intent_id).toBe(piId);
    expect(second.authorization_expires_at?.getTime()).toBe(T0.getTime() + AUTHORIZATION_TTL_MS);
    expect(second).toEqual(first);
  });
});

describe('captureEscrow', () => {
  it('rejects a pending escrow', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    await createEscrow(world.deps, job);
    await expect(captureEscrow(world.deps, JOB_ID)).rejects.toBeInstanceOf(InvalidStateError);
    expect(world.stripe.callsTo('paymentIntents.capture')).toHaveLength(0);
  });

  it('captures an authorized escrow once and records the charge id', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    const piId = await createAndAuthorize(world, job);

    const { escrow, chargeId } = await captureEscrow(world.deps, JOB_ID);
    const calls = world.stripe.callsTo('paymentIntents.capture');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toEqual({ id: piId, params: { amount_to_capture: 6000 } });
    expect(calls[0]?.idempotencyKey).toBe(`capture:${JOB_ID}`);
    expect(escrow.status).toBe('captured');
    expect((await world.repo.getEscrow(JOB_ID))?.status).toBe('captured');
    expect(chargeId).toMatch(/^ch_test_/);

    const line = await world.repo.getLedgerByKey(`escrow_capture:${JOB_ID}`);
    expect(line?.kind).toBe('escrow_capture');
    expect(line?.amount_cents).toBe(6000);
    expect(line?.stripe_ref).toMatch(/^ch_test_/);
    expect(line?.stripe_ref).toBe(chargeId);

    const again = await captureEscrow(world.deps, JOB_ID);
    expect(world.stripe.callsTo('paymentIntents.capture')).toHaveLength(1);
    expect(again.chargeId).toBe(chargeId);
    expect(world.repo.ledger.filter((l) => l.kind === 'escrow_capture')).toHaveLength(1);
  });
});

describe('releaseEscrow', () => {
  it('cancels the PaymentIntent of an authorized escrow and fires the hook once', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    const piId = await createAndAuthorize(world, job);

    const released = await releaseEscrow(world.deps, JOB_ID);
    const calls = world.stripe.callsTo('paymentIntents.cancel');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.idempotencyKey).toBe(`release:${JOB_ID}`);
    expect((calls[0]?.params as { id: string }).id).toBe(piId);
    expect(released.status).toBe('released');
    expect(world.stripe.piStore.get(piId)?.status).toBe('canceled');

    const line = await world.repo.getLedgerByKey(`escrow_release:${JOB_ID}`);
    expect(line?.kind).toBe('escrow_release');
    expect(line?.amount_cents).toBe(6000);
    expect(line?.stripe_ref).toBe(piId);

    expect(releasedHooks(world)).toEqual([{ name: 'onEscrowReleased', args: [JOB_ID, 'released'] }]);
  });

  it('refuses a captured escrow (must refund instead)', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    await fundAndCapture(world, job);
    await expect(releaseEscrow(world.deps, JOB_ID)).rejects.toBeInstanceOf(InvalidStateError);
    expect(world.stripe.callsTo('paymentIntents.cancel')).toHaveLength(0);
  });

  it('is a no-op on an already released escrow', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    await createAndAuthorize(world, job);
    await releaseEscrow(world.deps, JOB_ID);
    await releaseEscrow(world.deps, JOB_ID);
    expect(world.stripe.callsTo('paymentIntents.cancel')).toHaveLength(1);
    expect(releasedHooks(world)).toHaveLength(1);
    expect(world.repo.ledger.filter((l) => l.kind === 'escrow_release')).toHaveLength(1);
  });

  it('releases a pending escrow that has no PaymentIntent without calling Stripe', async () => {
    const world = makeWorld();
    world.repo.seedJob(makeJob());
    await world.repo.insertEscrow({
      job_id: JOB_ID,
      stripe_checkout_session_id: 'cs_manual',
      stripe_payment_intent_id: null,
      amount_cents: 6000,
      status: 'pending',
      authorization_expires_at: null,
    });
    const released = await releaseEscrow(world.deps, JOB_ID, 'customer_abandoned');
    expect(released.status).toBe('released');
    expect(world.stripe.calls).toHaveLength(0);
    const line = await world.repo.getLedgerByKey(`escrow_release:${JOB_ID}`);
    expect(line?.stripe_ref).toBe('reason:customer_abandoned');
    expect(line?.stripe_ref?.startsWith('reason:')).toBe(true);
    expect(releasedHooks(world)).toHaveLength(1);
  });
});

describe('markReleased (webhook path)', () => {
  it('releases once even when delivered twice', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    const piId = await createAndAuthorize(world, job);

    const first = await markReleased(world.deps, JOB_ID);
    const second = await markReleased(world.deps, JOB_ID);
    expect(first.status).toBe('released');
    expect(second.status).toBe('released');
    expect(world.repo.ledger.filter((l) => l.kind === 'escrow_release')).toHaveLength(1);
    expect((await world.repo.getLedgerByKey(`escrow_release:${JOB_ID}`))?.stripe_ref).toBe(piId);
    expect(releasedHooks(world)).toEqual([{ name: 'onEscrowReleased', args: [JOB_ID, 'released'] }]);
    expect(world.stripe.callsTo('paymentIntents.cancel')).toHaveLength(0);
  });
});

describe('refund', () => {
  it('rejects an authorized (uncaptured) escrow', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    await createAndAuthorize(world, job);
    await expect(refund(world.deps, JOB_ID, 'why')).rejects.toBeInstanceOf(InvalidStateError);
    expect(world.stripe.callsTo('refunds.create')).toHaveLength(0);
  });

  it('refunds a captured escrow once', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    const { paymentIntentId } = await fundAndCapture(world, job);

    const refunded = await refund(world.deps, JOB_ID, 'proof rejected');
    const calls = world.stripe.callsTo('refunds.create');
    expect(calls).toHaveLength(1);
    expect((calls[0]?.params as { payment_intent: string }).payment_intent).toBe(paymentIntentId);
    expect(calls[0]?.idempotencyKey).toBe(`refund:${JOB_ID}`);
    expect(refunded.status).toBe('refunded');

    const line = await world.repo.getLedgerByKey(`refund:${JOB_ID}`);
    expect(line?.kind).toBe('refund');
    expect(line?.amount_cents).toBe(6000);
    expect(line?.stripe_ref).toMatch(/^re_test_/);
    expect(releasedHooks(world)).toEqual([{ name: 'onEscrowReleased', args: [JOB_ID, 'refunded'] }]);

    await refund(world.deps, JOB_ID, 'again');
    expect(world.stripe.callsTo('refunds.create')).toHaveLength(1);
    expect(releasedHooks(world)).toHaveLength(1);
    expect(world.repo.ledger.filter((l) => l.kind === 'refund')).toHaveLength(1);
  });
});

describe('markRefunded (webhook path)', () => {
  it('is idempotent and fires the hook once', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    await fundAndCapture(world, job);

    const first = await markRefunded(world.deps, JOB_ID, 6000, 're_dashboard');
    const second = await markRefunded(world.deps, JOB_ID, 6000, 're_dashboard');
    expect(first.status).toBe('refunded');
    expect(second.status).toBe('refunded');
    const lines = world.repo.ledger.filter((l) => l.kind === 'refund');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.amount_cents).toBe(6000);
    expect(lines[0]?.stripe_ref).toBe('re_dashboard');
    expect(releasedHooks(world)).toEqual([{ name: 'onEscrowReleased', args: [JOB_ID, 'refunded'] }]);
    expect(world.stripe.callsTo('refunds.create')).toHaveLength(0);
  });
});

describe('expireStaleEscrows', () => {
  it('releases every authorization older than 7 days', async () => {
    const world = makeWorld();
    const jobA = world.repo.seedJob(makeJob());
    const jobB = world.repo.seedJob(makeJob({ id: JOB_B }));
    await createAndAuthorize(world, jobA);
    await createAndAuthorize(world, jobB);

    world.clock.advance(7 * DAY_MS + MINUTE_MS);
    const released = await expireStaleEscrows(world.deps);
    expect([...released].sort()).toEqual([JOB_ID, JOB_B].sort());
    expect((await world.repo.getEscrow(JOB_ID))?.status).toBe('released');
    expect((await world.repo.getEscrow(JOB_B))?.status).toBe('released');
    expect(world.stripe.callsTo('paymentIntents.cancel')).toHaveLength(2);
  });

  it('leaves a younger authorization alone', async () => {
    const world = makeWorld();
    const jobA = world.repo.seedJob(makeJob());
    const jobB = world.repo.seedJob(makeJob({ id: JOB_B }));
    await createAndAuthorize(world, jobA);
    world.clock.advance(DAY_MS);
    await createAndAuthorize(world, jobB);

    world.clock.set(new Date(T0.getTime() + 7 * DAY_MS + MINUTE_MS));
    const released = await expireStaleEscrows(world.deps);
    expect(released).toEqual([JOB_ID]);
    expect((await world.repo.getEscrow(JOB_ID))?.status).toBe('released');
    expect((await world.repo.getEscrow(JOB_B))?.status).toBe('authorized');
  });

  it('does nothing before expiry', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    await createAndAuthorize(world, job);
    world.clock.advance(7 * DAY_MS - MINUTE_MS);
    expect(await expireStaleEscrows(world.deps)).toEqual([]);
  });
});
