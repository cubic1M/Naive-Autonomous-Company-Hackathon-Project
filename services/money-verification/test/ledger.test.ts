import { describe, expect, it } from 'vitest';
import { pnl, record, sumKind } from '../src/ledger.js';
import { HOUR_MS, JOB_ID, T0, makeWorld } from './helpers.js';

describe('record', () => {
  it('is idempotent on the idempotency key', async () => {
    const { repo } = makeWorld();
    const w = { jobId: JOB_ID, kind: 'fee' as const, amountCents: 1500, idempotencyKey: 'fee:1' };
    const first = await record(repo, w);
    const second = await record(repo, w);
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.entry.id).toBe(first.entry.id);
    expect(repo.ledger).toHaveLength(1);
  });

  it('defaults currency to usd and stripe_ref to null', async () => {
    const { repo } = makeWorld();
    const { entry } = await record(repo, { jobId: null, kind: 'stripe_cost', amountCents: 5, idempotencyKey: 'k' });
    expect(entry.currency).toBe('usd');
    expect(entry.stripe_ref).toBeNull();
    expect(entry.job_id).toBeNull();
  });

  it.each([-1, 1.5, Number.NaN])('rejects amount %s with RangeError before inserting', async (amountCents) => {
    const { repo } = makeWorld();
    await expect(record(repo, { jobId: JOB_ID, kind: 'fee', amountCents, idempotencyKey: 'bad' })).rejects.toThrow(
      RangeError,
    );
    expect(repo.ledger).toHaveLength(0);
  });
});

describe('pnl', () => {
  it('aggregates fees, payouts, refunds and costs', async () => {
    const { repo } = makeWorld();
    const lines = [
      ['fee', 1500],
      ['payout', 4500],
      ['refund', 600],
      ['stripe_cost', 200],
      ['kyc_cost', 100],
      ['dispute_loss', 1000],
    ] as const;
    for (const [kind, amountCents] of lines) {
      await record(repo, { jobId: JOB_ID, kind, amountCents, idempotencyKey: `${kind}:1` });
    }
    expect(await pnl(repo, {})).toEqual({
      feesCents: 1500,
      payoutsCents: 4500,
      refundsCents: 600,
      costsCents: 1300,
      grossMarginCents: -400,
      jobsPaid: 1,
    });
  });

  it('ignores escrow_* lines', async () => {
    const { repo } = makeWorld();
    await record(repo, { jobId: JOB_ID, kind: 'escrow_hold', amountCents: 6000, idempotencyKey: 'h' });
    await record(repo, { jobId: JOB_ID, kind: 'escrow_capture', amountCents: 6000, idempotencyKey: 'c' });
    expect(await pnl(repo, {})).toEqual({
      feesCents: 0,
      payoutsCents: 0,
      refundsCents: 0,
      costsCents: 0,
      grossMarginCents: 0,
      jobsPaid: 0,
    });
  });

  it('treats from as inclusive and to as exclusive', async () => {
    const world = makeWorld();
    const { repo, clock } = world;
    const t1 = new Date(T0.getTime() + HOUR_MS);
    await record(repo, { jobId: 'a', kind: 'fee', amountCents: 100, idempotencyKey: 'f0' }); // at T0
    clock.advance(HOUR_MS);
    await record(repo, { jobId: 'b', kind: 'fee', amountCents: 200, idempotencyKey: 'f1' }); // at T0+1h

    expect((await pnl(repo, { from: T0, to: t1 })).feesCents).toBe(100); // from inclusive, to exclusive
    expect((await pnl(repo, { from: t1 })).feesCents).toBe(200); // from == second line's time: included
    expect((await pnl(repo, { from: new Date(T0.getTime() + 1) })).feesCents).toBe(200); // first line excluded
    expect((await pnl(repo, { to: T0 })).feesCents).toBe(0); // to == first line's time: excluded
    expect((await pnl(repo, { to: new Date(t1.getTime() + 1) })).feesCents).toBe(300);
    expect((await pnl(repo, {})).feesCents).toBe(300);
  });
});

describe('sumKind', () => {
  it('sums only the requested kind inside [from, to)', async () => {
    const { repo, clock } = makeWorld();
    const t1 = new Date(T0.getTime() + HOUR_MS);
    const t2 = new Date(T0.getTime() + 2 * HOUR_MS);
    await record(repo, { jobId: 'a', kind: 'escrow_hold', amountCents: 100, idempotencyKey: 'h0' });
    await record(repo, { jobId: 'a', kind: 'fee', amountCents: 7, idempotencyKey: 'f0' });
    clock.advance(HOUR_MS);
    await record(repo, { jobId: 'b', kind: 'escrow_hold', amountCents: 200, idempotencyKey: 'h1' });
    clock.advance(HOUR_MS);
    await record(repo, { jobId: 'c', kind: 'escrow_hold', amountCents: 400, idempotencyKey: 'h2' });

    expect(await sumKind(repo, 'escrow_hold', T0, t2)).toBe(300); // excludes the line at t2
    expect(await sumKind(repo, 'escrow_hold', t1, t2)).toBe(200);
    expect(await sumKind(repo, 'escrow_hold', T0, new Date(t2.getTime() + 1))).toBe(700);
    expect(await sumKind(repo, 'fee', T0, t2)).toBe(7);
    expect(await sumKind(repo, 'payout', T0, t2)).toBe(0);
  });
});
