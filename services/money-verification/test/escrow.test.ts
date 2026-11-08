import { describe, expect, it } from 'vitest';
import {
  AUTHORIZATION_TTL_MS,
  captureEscrow,
  createEscrow,
  escrowAmountCents,
  expireStaleEscrows,
  markAuthorized,
  markRefunded,
  recordStripeRefund,
  markReleased,
  refund,
  releaseEscrow,
} from '../src/escrow.js';
import Stripe from 'stripe';
import { DailyCapExceededError, InvalidStateError, RequiresApprovalError } from '../src/errors.js';
import type { StripeClient } from '../src/stripe-client.js';
import type { Job } from '../src/types.js';
import { CUSTOMER_ID, HOUR_MS, JOB_ID, MINUTE_MS, T0, fundAndCapture, makeJob, makeWorld, type World } from './helpers.js';

/** The most recent refund the fake created, in the shape the refund.created webhook delivers it. */
const lastStripeRefund = (w: World) => [...w.stripe.rfStore.values()].at(-1) as unknown as Parameters<typeof recordStripeRefund>[1];
/** A refund made outside our code (dashboard / CLI): no idempotency key, no metadata. */
const dashboardRefund = async (w: World, paymentIntentId: string, amount: number) =>
  (await w.stripe.refunds.create({ payment_intent: paymentIntentId, amount })) as unknown as Parameters<typeof recordStripeRefund>[1];

const DAY_MS = 24 * HOUR_MS;
const JOB_B = '00000000-0000-4000-8000-0000000000b2';
const OTHER_CUSTOMER = '00000000-0000-4000-8000-0000000000c2';

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

  it('refunds a captured escrow in full once', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    const { paymentIntentId } = await fundAndCapture(world, job);

    const result = await refund(world.deps, JOB_ID, 'proof rejected');
    const calls = world.stripe.callsTo('refunds.create');
    expect(calls).toHaveLength(1);
    expect((calls[0]?.params as { payment_intent: string }).payment_intent).toBe(paymentIntentId);
    expect(calls[0]?.idempotencyKey).toBe(`refund:${JOB_ID}:0`);
    expect(result).toMatchObject({ refundCents: 6000, refundedTotalCents: 6000, fullyRefunded: true });
    expect(result.escrow.status).toBe('refunded');

    const lines = world.repo.ledger.filter((l) => l.kind === 'refund');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.amount_cents).toBe(6000);
    expect(lines[0]?.stripe_ref).toMatch(/^re_test_/);
    expect(releasedHooks(world)).toEqual([{ name: 'onEscrowReleased', args: [JOB_ID, 'refunded'] }]);

    const again = await refund(world.deps, JOB_ID, 'again');
    expect(again).toMatchObject({ refundCents: 0, refundedTotalCents: 6000, fullyRefunded: true, stripeRefundId: null });
    expect(world.stripe.callsTo('refunds.create')).toHaveLength(1);
    expect(releasedHooks(world)).toHaveLength(1);
    expect(world.repo.ledger.filter((l) => l.kind === 'refund')).toHaveLength(1);
  });

  it('refunds in two parts: stays captured after the first, refunded (hook once) after the second', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    await fundAndCapture(world, job);

    const first = await refund(world.deps, JOB_ID, 'partial credit', { amountCents: 2000 });
    expect(first).toMatchObject({ refundCents: 2000, refundedTotalCents: 2000, fullyRefunded: false });
    expect((await world.repo.getEscrow(JOB_ID))?.status).toBe('captured');
    expect(releasedHooks(world)).toHaveLength(0);

    const second = await refund(world.deps, JOB_ID, 'rest', { amountCents: 4000 });
    expect(second).toMatchObject({ refundCents: 4000, refundedTotalCents: 6000, fullyRefunded: true });
    expect((await world.repo.getEscrow(JOB_ID))?.status).toBe('refunded');
    expect(releasedHooks(world)).toEqual([{ name: 'onEscrowReleased', args: [JOB_ID, 'refunded'] }]);

    const calls = world.stripe.callsTo('refunds.create');
    expect(calls.map((c) => c.idempotencyKey)).toEqual([`refund:${JOB_ID}:0`, `refund:${JOB_ID}:1`]);
    expect(world.repo.ledger.filter((l) => l.kind === 'refund').map((l) => l.amount_cents)).toEqual([2000, 4000]);
  });

  it('rejects a partial refund above the remainder, and a non-positive one, without calling Stripe', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    await fundAndCapture(world, job);
    await refund(world.deps, JOB_ID, 'partial', { amountCents: 2000 });
    await expect(refund(world.deps, JOB_ID, 'too much', { amountCents: 4001 })).rejects.toBeInstanceOf(InvalidStateError);
    await expect(refund(world.deps, JOB_ID, 'zero', { amountCents: 0 })).rejects.toBeInstanceOf(InvalidStateError);
    expect(world.stripe.callsTo('refunds.create')).toHaveLength(1);
  });

  it('refuses a refund above the cap unless allowLarge', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob({ budget_cents: 24000 }));
    await fundAndCapture(world, job);

    await expect(refund(world.deps, JOB_ID, 'big')).rejects.toBeInstanceOf(RequiresApprovalError);
    expect(world.stripe.callsTo('refunds.create')).toHaveLength(0);
    expect((await world.repo.getEscrow(JOB_ID))?.status).toBe('captured');

    const approved = await refund(world.deps, JOB_ID, 'big, CEO approved', { allowLarge: true });
    expect(approved).toMatchObject({ refundCents: 24000, fullyRefunded: true });
    expect(world.stripe.callsTo('refunds.create')).toHaveLength(1);
  });

  it('applies the cap to the job\'s cumulative refunds, so splitting into small partials still needs approval', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob({ budget_cents: 24000 }));
    await fundAndCapture(world, job);

    await expect(refund(world.deps, JOB_ID, 'first', { amountCents: 15000 })).resolves.toMatchObject({ fullyRefunded: false });
    await expect(refund(world.deps, JOB_ID, 'second', { amountCents: 9000 })).rejects.toBeInstanceOf(RequiresApprovalError);
    expect(world.stripe.callsTo('refunds.create')).toHaveLength(1);
    expect((await world.repo.getEscrow(JOB_ID))?.status).toBe('captured');

    const approved = await refund(world.deps, JOB_ID, 'second, CEO approved', { amountCents: 9000, allowLarge: true });
    expect(approved).toMatchObject({ refundedTotalCents: 24000, fullyRefunded: true });
  });

  /** Makes the next refund ledger insert throw, i.e. a crash after Stripe accepted the refund. */
  function crashNextRefundLedgerWrite(world: World): void {
    const real = world.repo.insertLedger.bind(world.repo);
    let armed = true;
    world.repo.insertLedger = async (entry) => {
      if (armed && entry.kind === 'refund') {
        armed = false;
        throw new Error('crash before ledger write');
      }
      return real(entry);
    };
  }

  it('a retry of the same partial (crash before the ledger write) replays the Stripe refund, not a second one', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    await fundAndCapture(world, job);
    crashNextRefundLedgerWrite(world);
    await expect(refund(world.deps, JOB_ID, 'first try', { amountCents: 2000 })).rejects.toThrow('crash before ledger write');
    expect(world.stripe.rfStore.size).toBe(1);

    // Production-shaped first call, then a retry with a reworded reason: same Stripe params, so it replays.
    const result = await refund(world.deps, JOB_ID, 'retry', { amountCents: 2000 });
    expect(result).toMatchObject({ refundCents: 2000, refundedTotalCents: 2000, fullyRefunded: false });
    expect(world.stripe.rfStore.size).toBe(1);
    expect(world.repo.ledger.filter((l) => l.kind === 'refund')).toHaveLength(1);
  });

  it('a retry after a crash with a DIFFERENT amount is rejected by Stripe\'s key-reuse rule, not silently answered with the stale refund', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    await fundAndCapture(world, job);
    crashNextRefundLedgerWrite(world);
    await expect(refund(world.deps, JOB_ID, 'first try', { amountCents: 2000 })).rejects.toThrow('crash before ledger write');

    await expect(refund(world.deps, JOB_ID, 'bigger', { amountCents: 3000 })).rejects.toMatchObject({ type: 'StripeIdempotencyError' });
    expect(world.stripe.rfStore.size).toBe(1);
    expect(world.repo.ledger.filter((l) => l.kind === 'refund')).toHaveLength(0);
  });
});

describe('refund with a caller request_id (replay safety)', () => {
  it('a replay of a completed partial returns the first refund and creates no second one', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    await fundAndCapture(world, job);
    const first = await refund(world.deps, JOB_ID, 'partial credit', { amountCents: 2000, requestId: 'req-1' });
    const replay = await refund(world.deps, JOB_ID, 'partial credit', { amountCents: 2000, requestId: 'req-1' });
    expect(replay).toMatchObject({ refundCents: 2000, refundedTotalCents: 2000, stripeRefundId: first.stripeRefundId });
    expect(world.stripe.rfStore.size).toBe(1);
    expect(world.repo.ledger.filter((l) => l.kind === 'refund')).toHaveLength(1);
  });

  it('a different request_id for the same amount is a second intended refund', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    await fundAndCapture(world, job);
    await refund(world.deps, JOB_ID, 'credit', { amountCents: 2000, requestId: 'req-1' });
    const second = await refund(world.deps, JOB_ID, 'credit', { amountCents: 2000, requestId: 'req-2' });
    expect(second.refundedTotalCents).toBe(4000);
    expect(world.stripe.rfStore.size).toBe(2);
  });

  it('a replay of the request that completed the refund returns it and does not fire the hook again', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    await fundAndCapture(world, job);
    await refund(world.deps, JOB_ID, 'all', { requestId: 'req-full' });
    const replay = await refund(world.deps, JOB_ID, 'all', { requestId: 'req-full' });
    expect(replay).toMatchObject({ refundCents: 6000, fullyRefunded: true });
    expect(world.stripe.rfStore.size).toBe(1);
  });
});

describe('refund retry after the crash + webhook ordering', () => {
  it('a request_id retry after the Stripe call succeeded, the ledger write failed and charge.refunded landed creates no second Stripe refund', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    const { paymentIntentId } = await fundAndCapture(world, job);
    const realInsert = world.repo.insertLedger.bind(world.repo);
    let blip = true;
    world.repo.insertLedger = async (entry) => {
      if (blip && entry.kind === 'refund') {
        blip = false;
        throw new Error('simulated DB outage after Stripe succeeded');
      }
      return realInsert(entry);
    };
    await expect(refund(world.deps, JOB_ID, 'partial credit', { amountCents: 2000, requestId: 'req-1' })).rejects.toThrow('simulated');
    // Stripe's echoes of that refund land before the agent retries: refund.created writes the line under the request key.
    await recordStripeRefund(world.deps, lastStripeRefund(world));
    await markRefunded(world.deps, JOB_ID, 2000, paymentIntentId);
    expect(world.repo.ledger.filter((l) => l.kind === 'refund').map((l) => l.idempotency_key)).toEqual([`refund:${JOB_ID}:req:req-1`]);

    const retry = await refund(world.deps, JOB_ID, 'partial credit', { amountCents: 2000, requestId: 'req-1' });
    expect(retry).toMatchObject({ refundCents: 2000, refundedTotalCents: 2000, fullyRefunded: false });
    expect(world.stripe.rfStore.size).toBe(1);
    expect(world.stripe.callsTo('refunds.create')).toHaveLength(1); // the replay was answered from the ledger
    expect(world.repo.ledger.filter((l) => l.kind === 'refund')).toHaveLength(1);
  });
});

describe('refund under Stripe\'s real idempotency rule (same key => same params)', () => {
  /** Models the documented rule the fake ignores: a reused key with different params is an idempotency_error. */
  function enforceSameParams(world: World): void {
    const seen = new Map<string, string>();
    const create = world.stripe.refunds.create.bind(world.stripe.refunds);
    world.stripe.refunds.create = (async (params, options) => {
      const key = options?.idempotencyKey;
      const body = JSON.stringify(params);
      if (key !== undefined && seen.has(key) && seen.get(key) !== body) {
        throw Object.assign(new Error(`Keys for idempotent requests can only be used with the same parameters (${key})`), { rawType: 'idempotency_error' });
      }
      if (key !== undefined) seen.set(key, body);
      return create(params, options);
    }) as typeof world.stripe.refunds.create;
  }

  it('a retry with reworded reason text replays instead of hitting idempotency_error', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    await fundAndCapture(world, job);
    enforceSameParams(world);
    const realInsert = world.repo.insertLedger.bind(world.repo);
    let blip = true;
    world.repo.insertLedger = async (entry) => {
      if (blip && entry.kind === 'refund') {
        blip = false;
        throw new Error('simulated DB outage after Stripe succeeded');
      }
      return realInsert(entry);
    };
    await expect(refund(world.deps, JOB_ID, 'partial credit', { amountCents: 2000, requestId: 'req-1' })).rejects.toThrow('simulated');

    const retry = await refund(world.deps, JOB_ID, 'retry after db error, customer unhappy', { amountCents: 2000, requestId: 'req-1' });
    expect(retry).toMatchObject({ refundCents: 2000, refundedTotalCents: 2000 });
    expect(world.stripe.rfStore.size).toBe(1);
  });
});

describe('webhook paths: refund.created writes lines, charge.refunded reconciles status', () => {
  it('charge.refunded alone flips the status once and writes no ledger line', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    await fundAndCapture(world, job);

    const first = await markRefunded(world.deps, JOB_ID, 6000, 'ch_dashboard');
    const second = await markRefunded(world.deps, JOB_ID, 6000, 'ch_dashboard');
    expect(first.status).toBe('refunded');
    expect(second.status).toBe('refunded');
    expect(world.repo.ledger.filter((l) => l.kind === 'refund')).toHaveLength(0);
    expect(releasedHooks(world)).toEqual([{ name: 'onEscrowReleased', args: [JOB_ID, 'refunded'] }]);
    expect(world.stripe.callsTo('refunds.create')).toHaveLength(0);
  });

  it('a dashboard refund reaches the ledger through refund.created, once, and the status flips once', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    const { paymentIntentId } = await fundAndCapture(world, job);
    const rf = await dashboardRefund(world, paymentIntentId, 6000);

    const e = await recordStripeRefund(world.deps, rf);
    await recordStripeRefund(world.deps, rf); // Stripe redelivers
    await markRefunded(world.deps, JOB_ID, 6000, 'ch_dashboard');
    expect(e?.status).toBe('refunded');
    const lines = world.repo.ledger.filter((l) => l.kind === 'refund');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ amount_cents: 6000, stripe_ref: rf.id, idempotency_key: `refund:${JOB_ID}:${rf.id}` });
    expect(releasedHooks(world)).toHaveLength(1);
  });

  it('a refund for a payment intent we do not know is ignored', async () => {
    const world = makeWorld();
    const unknown = { id: 're_other', amount: 100, status: 'succeeded', payment_intent: 'pi_other', metadata: {} } as unknown as Parameters<typeof recordStripeRefund>[1];
    expect(await recordStripeRefund(world.deps, unknown)).toBeNull();
    expect(world.repo.ledger).toHaveLength(0);
  });

  it('a failed refund writes nothing', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    const { paymentIntentId } = await fundAndCapture(world, job);
    const failed = { ...(await dashboardRefund(world, paymentIntentId, 6000)), status: 'failed' } as unknown as Parameters<typeof recordStripeRefund>[1];
    await recordStripeRefund(world.deps, failed);
    expect(world.repo.ledger.filter((l) => l.kind === 'refund')).toHaveLength(0);
    expect((await world.repo.getEscrow(JOB_ID))?.status).toBe('captured');
  });

  it('does not double count our own partial refund when its echoes arrive, then a dashboard refund completes it', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    const { paymentIntentId } = await fundAndCapture(world, job);
    await refund(world.deps, JOB_ID, 'partial', { amountCents: 2000 });

    await recordStripeRefund(world.deps, lastStripeRefund(world));
    const e = await markRefunded(world.deps, JOB_ID, 2000, 'ch_echo');
    expect(e.status).toBe('captured');
    expect(world.repo.ledger.filter((l) => l.kind === 'refund').map((l) => l.amount_cents)).toEqual([2000]);

    const rest = await dashboardRefund(world, paymentIntentId, 4000);
    const done = await recordStripeRefund(world.deps, rest);
    await markRefunded(world.deps, JOB_ID, 6000, 'ch_echo');
    expect(done?.status).toBe('refunded');
    expect(world.repo.ledger.filter((l) => l.kind === 'refund').map((l) => l.amount_cents)).toEqual([2000, 4000]);
    expect(releasedHooks(world)).toHaveLength(1);
  });
});

describe('refund racing its own webhook echo', () => {
  it('counts a partial refund once and "refund the rest" refunds the true remainder', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    await fundAndCapture(world, job);

    // Deliver Stripe's refund.created echo after Stripe created the refund but just before our ledger write.
    const realInsert = world.repo.insertLedger.bind(world.repo);
    let echoed = false;
    world.repo.insertLedger = async (entry) => {
      if (entry.kind === 'refund' && !echoed) {
        echoed = true;
        await recordStripeRefund(world.deps, lastStripeRefund(world));
        await markRefunded(world.deps, JOB_ID, 2000, 'ch_echo');
      }
      return realInsert(entry);
    };

    const first = await refund(world.deps, JOB_ID, 'partial', { amountCents: 2000 });
    expect(first).toMatchObject({ refundCents: 2000, refundedTotalCents: 2000, fullyRefunded: false });
    expect(world.repo.ledger.filter((l) => l.kind === 'refund').map((l) => l.amount_cents)).toEqual([2000]);

    const rest = await refund(world.deps, JOB_ID, 'the rest');
    expect(rest).toMatchObject({ refundCents: 4000, refundedTotalCents: 6000, fullyRefunded: true });
    expect(rest.escrow.status).toBe('refunded');
    expect(releasedHooks(world)).toHaveLength(1);
  });

  it('with a request_id (the agent path) both writers use the request key, so the race still counts once', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    await fundAndCapture(world, job);
    const realInsert = world.repo.insertLedger.bind(world.repo);
    let echoed = false;
    world.repo.insertLedger = async (entry) => {
      if (entry.kind === 'refund' && !echoed) {
        echoed = true;
        await recordStripeRefund(world.deps, lastStripeRefund(world));
      }
      return realInsert(entry);
    };
    const first = await refund(world.deps, JOB_ID, 'partial', { amountCents: 2000, requestId: 'r1' });
    expect(first).toMatchObject({ refundCents: 2000, refundedTotalCents: 2000 });
    const lines = world.repo.ledger.filter((l) => l.kind === 'refund');
    expect(lines.map((l) => l.idempotency_key)).toEqual([`refund:${JOB_ID}:req:r1`]);
    expect(world.stripe.rfStore.get(first.stripeRefundId as string)?.metadata).toEqual({ job_id: JOB_ID, request_id: 'r1' });
  });
});

describe('refund racing the webhook echo after its ledger write', () => {
  it('fires onEscrowReleased once when the full-refund echo lands between the ledger insert and the status flip', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    await fundAndCapture(world, job);

    const realInsert = world.repo.insertLedger.bind(world.repo);
    let echoed = false;
    world.repo.insertLedger = async (entry) => {
      const result = await realInsert(entry);
      if (entry.kind === 'refund' && !echoed) {
        echoed = true;
        await recordStripeRefund(world.deps, lastStripeRefund(world));
        await markRefunded(world.deps, JOB_ID, 6000, 'ch_echo');
      }
      return result;
    };

    const res = await refund(world.deps, JOB_ID, 'proof rejected');
    expect(res).toMatchObject({ refundedTotalCents: 6000, fullyRefunded: true });
    expect(world.repo.ledger.filter((l) => l.kind === 'refund').map((l) => l.amount_cents)).toEqual([6000]);
    expect((await world.repo.getEscrow(JOB_ID))?.status).toBe('refunded');
    expect(releasedHooks(world)).toHaveLength(1);
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

describe('createEscrow: direct hold against a payment instrument (agent-payable escrow)', () => {
  const fundedHooks = (world: World) => world.fired.filter((f) => f.name === 'onJobFunded');
  const piCalls = (world: World) => world.stripe.callsTo('paymentIntents.create');
  const checkoutCalls = (world: World) => world.stripe.callsTo('checkout.sessions.create');
  const CUSTOMER = {
    customer_id: CUSTOMER_ID,
    name: 'Acme Agent',
    email: 'ops@acme.test',
    stripe_customer_id: 'cus_acme',
    default_payment_method_id: 'pm_saved_acme',
  };

  it('authorizes a passed payment_method off-session: no Checkout, escrow authorized, hold line, funded, onJobFunded', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob({ status: 'requested' }));
    const r = await createEscrow(world.deps, job, { paymentMethod: 'pm_card_visa' });

    expect(r.url).toBeNull();
    expect(r.funded).toBe(true);
    expect(r.fallback_reason).toBeUndefined();
    expect(checkoutCalls(world)).toHaveLength(0);
    const call = piCalls(world)[0];
    expect(call?.params).toMatchObject({
      amount: 6000,
      currency: 'usd',
      payment_method: 'pm_card_visa',
      off_session: true,
      confirm: true,
      capture_method: 'manual',
      transfer_group: `job:${JOB_ID}`,
      metadata: { job_id: JOB_ID },
    });
    expect(call?.params).not.toHaveProperty('customer');
    expect(call?.idempotencyKey).toBe(`escrow:${JOB_ID}:pi`);

    const row = await world.repo.getEscrow(JOB_ID);
    expect(row).toMatchObject({ status: 'authorized', stripe_checkout_session_id: null, amount_cents: 6000 });
    expect(row?.stripe_payment_intent_id).toMatch(/^pi_test_/);
    expect(row?.authorization_expires_at?.getTime()).toBe(T0.getTime() + AUTHORIZATION_TTL_MS);
    expect(r.escrow).toEqual(row);
    expect(world.repo.ledger.map((l) => [l.kind, l.amount_cents, l.idempotency_key, l.stripe_ref])).toEqual([
      ['escrow_hold', 6000, `escrow_hold:${JOB_ID}`, row?.stripe_payment_intent_id],
    ]);
    expect(fundedHooks(world).map((f) => f.args)).toEqual([[JOB_ID]]);
  });

  it('a retry returns the same funded escrow with no second Stripe call, line or hook', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob({ status: 'requested' }));
    const first = await createEscrow(world.deps, job, { paymentMethod: 'pm_card_visa' });
    const again = await createEscrow(world.deps, job, { paymentMethod: 'pm_card_visa' });
    expect(again).toMatchObject({ url: null, funded: true });
    expect(again.escrow.stripe_payment_intent_id).toBe(first.escrow.stripe_payment_intent_id);
    expect(piCalls(world)).toHaveLength(1);
    expect(world.repo.ledger.filter((l) => l.kind === 'escrow_hold')).toHaveLength(1);
    expect(fundedHooks(world)).toHaveLength(1);
  });

  it('a declined card falls back to Checkout with the reason, under the Checkout key', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob({ status: 'requested' }));
    const r = await createEscrow(world.deps, job, { paymentMethod: 'pm_card_chargeDeclined' });
    expect(r.funded).toBe(false);
    expect(r.fallback_reason).toBe('card_declined');
    expect(r.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    expect(piCalls(world)[0]?.idempotencyKey).toBe(`escrow:${JOB_ID}:pi`);
    expect(checkoutCalls(world)[0]?.idempotencyKey).toBe(`escrow:${JOB_ID}`);
    const row = await world.repo.getEscrow(JOB_ID);
    expect(row?.status).toBe('pending');
    expect(row?.stripe_checkout_session_id).toMatch(/^cs_test_/);
    const declined = [...world.stripe.piStore.values()].find((p) => p.payment_method === 'pm_card_chargeDeclined');
    expect(declined?.status).toBe('requires_payment_method');
    expect(row?.stripe_payment_intent_id).not.toBe(declined?.id);
    expect(fundedHooks(world)).toHaveLength(0);
  });

  it('a card that needs authentication falls back with authentication_required', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob({ status: 'requested' }));
    const r = await createEscrow(world.deps, job, { paymentMethod: 'pm_card_authenticationRequired' });
    expect(r).toMatchObject({ funded: false, fallback_reason: 'authentication_required' });
    expect(r.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
  });

  it('an id that is not a PaymentMethod falls back with invalid_payment_method', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob({ status: 'requested' }));
    const r = await createEscrow(world.deps, job, { paymentMethod: 'tok_visa' });
    expect(r).toMatchObject({ funded: false, fallback_reason: 'invalid_payment_method' });
    expect((await world.repo.getEscrow(JOB_ID))?.status).toBe('pending');
  });

  it('any other Stripe failure propagates: no silent fallback, no escrow row', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob({ status: 'requested' }));
    const broken: StripeClient = {
      ...world.stripe,
      paymentIntents: {
        ...world.stripe.paymentIntents,
        create: async () => {
          throw new Stripe.errors.StripeAPIError({ type: 'api_error', message: 'stripe is down' });
        },
      },
    };
    await expect(createEscrow({ ...world.deps, stripe: broken }, job, { paymentMethod: 'pm_card_visa' })).rejects.toThrow('stripe is down');
    expect(await world.repo.getEscrow(JOB_ID)).toBeNull();
    expect(checkoutCalls(world)).toHaveLength(0);
  });

  it('the daily cap applies before any Stripe call on the direct path too', async () => {
    const world = makeWorld();
    const jobA = world.repo.seedJob(makeJob({ budget_cents: 150_000, status: 'requested' }));
    const jobB = world.repo.seedJob(makeJob({ id: JOB_B, budget_cents: 60_000, status: 'requested' }));
    await createEscrow(world.deps, jobA, { paymentMethod: 'pm_card_visa' });
    await expect(createEscrow(world.deps, jobB, { paymentMethod: 'pm_card_visa' })).rejects.toBeInstanceOf(DailyCapExceededError);
    expect(piCalls(world)).toHaveLength(1);
    expect(await world.repo.getEscrow(JOB_B)).toBeNull();
  });

  it('card on file: funds from the saved instrument and Stripe Customer with no option passed', async () => {
    const world = makeWorld();
    world.repo.seedCustomer(CUSTOMER);
    const job = world.repo.seedJob(makeJob({ status: 'requested' }));
    world.repo.linkJobToCustomer(JOB_ID, CUSTOMER_ID);
    const r = await createEscrow(world.deps, job);
    expect(r).toMatchObject({ url: null, funded: true });
    expect(piCalls(world)[0]?.params).toMatchObject({ customer: 'cus_acme', payment_method: 'pm_saved_acme', off_session: true });
    expect(checkoutCalls(world)).toHaveLength(0);
  });

  it('a payment_method passed in the call wins over the card on file and is charged without the Customer', async () => {
    const world = makeWorld();
    world.repo.seedCustomer(CUSTOMER);
    const job = world.repo.seedJob(makeJob({ status: 'requested' }));
    world.repo.linkJobToCustomer(JOB_ID, CUSTOMER_ID);
    await createEscrow(world.deps, job, { paymentMethod: 'pm_card_visa' });
    const params = piCalls(world)[0]?.params;
    expect(params).toMatchObject({ payment_method: 'pm_card_visa' });
    expect(params).not.toHaveProperty('customer');
  });

  it("never charges another customer's card: the job's own customer has none, so Checkout", async () => {
    const world = makeWorld();
    world.repo.seedCustomer(CUSTOMER);
    world.repo.seedCustomer({ ...CUSTOMER, customer_id: OTHER_CUSTOMER, stripe_customer_id: null, default_payment_method_id: null });
    const job = world.repo.seedJob(makeJob({ status: 'requested' }));
    world.repo.linkJobToCustomer(JOB_ID, OTHER_CUSTOMER);
    const r = await createEscrow(world.deps, job);
    expect(r.funded).toBe(false);
    expect(r.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    expect(piCalls(world)).toHaveLength(0);
  });

  it('no instrument: the Checkout path is unchanged and reports not funded', async () => {
    const world = makeWorld();
    world.repo.seedCustomer({ ...CUSTOMER, default_payment_method_id: null });
    const job = world.repo.seedJob(makeJob({ status: 'requested' }));
    world.repo.linkJobToCustomer(JOB_ID, CUSTOMER_ID);
    const r = await createEscrow(world.deps, job);
    expect(r.funded).toBe(false);
    expect(r.fallback_reason).toBeUndefined();
    expect(r.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    expect(piCalls(world)).toHaveLength(0);
    expect(fundedHooks(world)).toHaveLength(0);
  });

  it('an existing pending Checkout escrow keeps its session even when an instrument is passed later', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob({ status: 'requested' }));
    const first = await createEscrow(world.deps, job);
    const second = await createEscrow(world.deps, job, { paymentMethod: 'pm_card_visa' });
    expect(second.url).toBe(first.url);
    expect(second.funded).toBe(false);
    expect(piCalls(world)).toHaveLength(0);
  });
});
