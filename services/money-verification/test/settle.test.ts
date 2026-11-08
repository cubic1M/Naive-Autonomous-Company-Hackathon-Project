import { describe, expect, it } from 'vitest';
import { InvalidStateError } from '../src/errors.js';
import { completePendingPayoutsForWorker } from '../src/payouts.js';
import { settleApprovedJob } from '../src/settle.js';
import { JOB_ID, WORKER_ID, approvedReview, makeJob, makeWorker, makeWorld, type World } from './helpers.js';
import { createEscrow, markAuthorized } from '../src/escrow.js';

/** Escrow authorized (not captured), approved review, worker with the given account state. */
async function setup(account: 'ready' | 'none', approve = true) {
  const world = makeWorld();
  const job = world.repo.seedJob(makeJob());
  let accountId: string | null = null;
  if (account === 'ready') {
    accountId = (await world.stripe.accounts.create({ type: 'express' })).id;
    world.stripe.enablePayouts(accountId);
  }
  world.repo.seedWorker(makeWorker({ stripe_connect_account: accountId }));
  if (approve) await world.repo.upsertProofReview(approvedReview());
  const { escrow } = await createEscrow(world.deps, job);
  const sessionId = escrow.stripe_checkout_session_id ?? '';
  world.stripe.completeCheckout(sessionId);
  await markAuthorized(world.deps, JOB_ID, world.stripe.csStore.get(sessionId)?.payment_intent ?? '');
  return world;
}

const lines = (w: World, kind: string) => w.repo.ledger.filter((l) => l.kind === kind);

describe('settleApprovedJob', () => {
  it('captures once and transfers once across repeated calls', async () => {
    const world = await setup('ready');

    const first = await settleApprovedJob(world.deps, JOB_ID);
    const second = await settleApprovedJob(world.deps, JOB_ID);

    expect(world.stripe.callsTo('paymentIntents.capture')).toHaveLength(1);
    expect(world.stripe.callsTo('transfers.create')).toHaveLength(1);
    expect(lines(world, 'fee')).toHaveLength(1);
    expect(lines(world, 'payout')).toHaveLength(1);
    expect(lines(world, 'escrow_capture')).toHaveLength(1);
    expect(first.payout).toMatchObject({ status: 'paid', transferred: true });
    expect(second.payout).toMatchObject({ status: 'paid', transferred: false });
    expect(first.chargeId).toMatch(/^ch_test_/);
    expect(second.chargeId).toBe(first.chargeId);
  });

  it('refuses without an approved review and captures nothing', async () => {
    const world = await setup('ready', false);
    await expect(settleApprovedJob(world.deps, JOB_ID)).rejects.toBeInstanceOf(InvalidStateError);

    await world.repo.upsertProofReview(approvedReview({ decision: 'rejected' }));
    await expect(settleApprovedJob(world.deps, JOB_ID)).rejects.toBeInstanceOf(InvalidStateError);
    expect(world.stripe.callsTo('paymentIntents.capture')).toHaveLength(0);
  });

  it('captures but parks the payout when the worker has no account, then completes after onboarding', async () => {
    const world = await setup('none');

    const first = await settleApprovedJob(world.deps, JOB_ID);
    expect(first.payout.status).toBe('pending_onboarding');
    expect(world.repo.escrows.get(JOB_ID)?.status).toBe('captured');
    expect(world.stripe.callsTo('transfers.create')).toHaveLength(0);
    if (first.payout.status !== 'pending_onboarding') throw new Error('unreachable');

    world.stripe.enablePayouts(first.payout.accountId);
    const done = await completePendingPayoutsForWorker(world.deps, WORKER_ID);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ status: 'paid', transferred: true });

    const third = await settleApprovedJob(world.deps, JOB_ID);
    expect(third.payout).toMatchObject({ status: 'paid', transferred: false });
    expect(world.stripe.callsTo('transfers.create')).toHaveLength(1);
    expect(world.stripe.callsTo('paymentIntents.capture')).toHaveLength(1);
  });
});
