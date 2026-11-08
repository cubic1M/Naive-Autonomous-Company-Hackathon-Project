import { describe, expect, it } from 'vitest';
import { createEscrow, markAuthorized } from '../src/escrow.js';
import { InvalidStateError, RequiresApprovalError } from '../src/errors.js';
import { completePendingPayoutsForWorker, payWorker } from '../src/payouts.js';
import {
  JOB_ID,
  WORKER_ID,
  approvedReview,
  fundAndCapture,
  makeJob,
  makeWorker,
  makeWorld,
  type World,
} from './helpers.js';

/** Seed a job + worker + approved review and walk the escrow to captured. */
async function setup(opts: { account: 'ready' | 'unfinished' | 'none'; budgetCents?: number }) {
  const world = makeWorld();
  const job = world.repo.seedJob(makeJob(opts.budgetCents ? { budget_cents: opts.budgetCents } : {}));
  let accountId: string | null = null;
  if (opts.account !== 'none') {
    const acct = await world.stripe.accounts.create({ type: 'express' });
    accountId = acct.id;
    if (opts.account === 'ready') world.stripe.enablePayouts(accountId);
  }
  world.repo.seedWorker(makeWorker({ stripe_connect_account: accountId }));
  await world.repo.upsertProofReview(approvedReview());
  const { chargeId } = await fundAndCapture(world, job);
  return { world, job, accountId, chargeId };
}

const ledgerOf = (w: World, kind: string) => w.repo.ledger.filter((l) => l.kind === kind);

describe('payWorker', () => {
  it('pays 75% to a payout-ready worker with the right Stripe params, ledger, row and hook', async () => {
    const { world, accountId, chargeId } = await setup({ account: 'ready' });

    const res = await payWorker(world.deps, JOB_ID);

    expect(res).toMatchObject({ status: 'paid', amountCents: 4500, transferred: true });
    const calls = world.stripe.callsTo('transfers.create');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toMatchObject({
      amount: 4500,
      destination: accountId,
      transfer_group: `job:${JOB_ID}`,
      source_transaction: chargeId,
    });
    expect(chargeId).toMatch(/^ch_test_/);
    expect(calls[0]?.idempotencyKey).toBe(`payout:${JOB_ID}`);
    expect(ledgerOf(world, 'payout').map((l) => l.amount_cents)).toEqual([4500]);
    expect(ledgerOf(world, 'fee').map((l) => l.amount_cents)).toEqual([1500]);
    const transferId = res.status === 'paid' ? res.transferId : '';
    expect(world.repo.payouts.get(JOB_ID)).toMatchObject({ status: 'paid', stripe_transfer_id: transferId });
    const paid = world.fired.filter((f) => f.name === 'onWorkerPaid');
    expect(paid).toHaveLength(1);
    expect(paid[0]?.args).toEqual([JOB_ID, WORKER_ID, transferId]);
  });

  it('refuses before capture: authorized-only escrow', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    world.repo.seedWorker(makeWorker());
    await world.repo.upsertProofReview(approvedReview());
    const { escrow } = await createEscrow(world.deps, job);
    const sessionId = escrow.stripe_checkout_session_id ?? '';
    world.stripe.completeCheckout(sessionId);
    await markAuthorized(world.deps, JOB_ID, world.stripe.csStore.get(sessionId)?.payment_intent ?? '');

    await expect(payWorker(world.deps, JOB_ID)).rejects.toBeInstanceOf(InvalidStateError);
    expect(world.stripe.callsTo('transfers.create')).toHaveLength(0);
    expect(world.stripe.callsTo('accounts.create')).toHaveLength(0);
    expect(world.repo.payouts.size).toBe(0);
  });

  it('refuses before approval: no review, and escalated review', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    world.repo.seedWorker(makeWorker());
    await fundAndCapture(world, job);

    await expect(payWorker(world.deps, JOB_ID)).rejects.toBeInstanceOf(InvalidStateError);
    await world.repo.upsertProofReview(approvedReview({ decision: 'escalated' }));
    await expect(payWorker(world.deps, JOB_ID)).rejects.toBeInstanceOf(InvalidStateError);
    expect(world.stripe.callsTo('transfers.create')).toHaveLength(0);
    expect(world.stripe.callsTo('accounts.create')).toHaveLength(0);
  });

  it('enforces the payout cap unless allowLarge', async () => {
    const { world } = await setup({ account: 'ready', budgetCents: 24_000 });

    const err = await payWorker(world.deps, JOB_ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RequiresApprovalError);
    expect(err).toMatchObject({ amountCents: 18_000, capCents: 15_000 });
    expect(world.stripe.callsTo('transfers.create')).toHaveLength(0);

    const res = await payWorker(world.deps, JOB_ID, { allowLarge: true });
    expect(res).toMatchObject({ status: 'paid', amountCents: 18_000 });
    expect(world.stripe.callsTo('transfers.create')).toHaveLength(1);
  });

  describe('first payout onboarding', () => {
    it('parks a worker with no account as pending_onboarding', async () => {
      const { world } = await setup({ account: 'none' });

      const res = await payWorker(world.deps, JOB_ID);

      expect(res.status).toBe('pending_onboarding');
      if (res.status !== 'pending_onboarding') throw new Error('unreachable');
      expect(res.onboardingUrl.startsWith('https://connect.stripe.test/onboard/acct_test_')).toBe(true);
      expect(res.amountCents).toBe(4500);
      const creates = world.stripe.callsTo('accounts.create');
      expect(creates).toHaveLength(1);
      expect(creates[0]?.params).toMatchObject({ type: 'express' });
      expect(world.repo.workers.get(WORKER_ID)?.stripe_connect_account).toBe(res.accountId);
      expect(world.repo.payouts.get(JOB_ID)).toMatchObject({
        status: 'pending_onboarding',
        stripe_transfer_id: null,
        stripe_connect_account: res.accountId,
        onboarding_url: res.onboardingUrl,
      });
      expect(world.stripe.callsTo('transfers.create')).toHaveLength(0);
      expect(ledgerOf(world, 'payout')).toHaveLength(0);
      expect(ledgerOf(world, 'fee')).toHaveLength(0);
    });

    it('stays pending while the account is not payouts_enabled, with one account ever created', async () => {
      const { world } = await setup({ account: 'none' });
      await payWorker(world.deps, JOB_ID);

      const again = await payWorker(world.deps, JOB_ID);

      expect(again.status).toBe('pending_onboarding');
      const creates = world.stripe.callsTo('accounts.create');
      expect(creates).toHaveLength(1);
      expect(creates[0]?.idempotencyKey).toBe(`connect:${WORKER_ID}`);
      expect(world.stripe.callsTo('transfers.create')).toHaveLength(0);
    });

    it('completes the pending payout once the account is enabled', async () => {
      const { world } = await setup({ account: 'none' });
      const parked = await payWorker(world.deps, JOB_ID);
      if (parked.status !== 'pending_onboarding') throw new Error('expected pending');
      world.stripe.enablePayouts(parked.accountId);

      const results = await completePendingPayoutsForWorker(world.deps, WORKER_ID);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ status: 'paid', amountCents: 4500, transferred: true });
      expect(world.stripe.callsTo('transfers.create')).toHaveLength(1);
      const transferId = results[0]?.status === 'paid' ? results[0].transferId : '';
      expect(world.repo.payouts.get(JOB_ID)).toMatchObject({ status: 'paid', stripe_transfer_id: transferId });
      expect(ledgerOf(world, 'payout')).toHaveLength(1);
      expect(ledgerOf(world, 'fee')).toHaveLength(1);
      expect(world.fired.filter((f) => f.name === 'onWorkerPaid')).toHaveLength(1);
    });

    it('completes a founder-approved large payout without tripping the cap again', async () => {
      const { world } = await setup({ account: 'none', budgetCents: 24_000 });
      const parked = await payWorker(world.deps, JOB_ID, { allowLarge: true });
      if (parked.status !== 'pending_onboarding') throw new Error('expected pending');
      world.stripe.enablePayouts(parked.accountId);

      const results = await completePendingPayoutsForWorker(world.deps, WORKER_ID);

      expect(results[0]).toMatchObject({ status: 'paid', amountCents: 18_000 });
    });
  });

  it('is idempotent after paid: no second transfer', async () => {
    const { world } = await setup({ account: 'ready' });
    await payWorker(world.deps, JOB_ID);

    const again = await payWorker(world.deps, JOB_ID);

    expect(again).toMatchObject({ status: 'paid', transferred: false });
    expect(world.stripe.callsTo('transfers.create')).toHaveLength(1);
    expect(world.fired.filter((f) => f.name === 'onWorkerPaid')).toHaveLength(1);
  });

  it('accountReady: true skips accounts.retrieve; otherwise it is called', async () => {
    const { world } = await setup({ account: 'ready' });
    await payWorker(world.deps, JOB_ID, { accountReady: true });
    expect(world.stripe.callsTo('accounts.retrieve')).toHaveLength(0);
    expect(world.stripe.callsTo('transfers.create')).toHaveLength(1);

    const second = await setup({ account: 'ready' });
    await payWorker(second.world.deps, JOB_ID);
    expect(second.world.stripe.callsTo('accounts.retrieve')).toHaveLength(1);
  });
});
