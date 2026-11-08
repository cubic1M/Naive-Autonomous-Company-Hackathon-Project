// services/money-verification/test/liability-pricing.test.ts
import { describe, expect, it } from 'vitest';
import { quote } from '../src/pricing.js';
import { connectorFeeCents, quoteJob } from '../src/liability/pricing.js';

describe('connectorFeeCents', () => {
  it.each([
    [2_000, 400],      // $20 -> $4.00
    [10_000, 2_000],   // $100 -> $20.00 (top of tier 1)
    [10_001, 2_000],   // 20.00 + 0.10 of a cent, rounds half-up to 2000
    [10_005, 2_001],   // 20.00 + 0.5 cent -> rounds up
    [20_000, 3_000],   // $200 -> $30.00
    [50_000, 6_000],   // $500 -> $20 + $40
    [100_000, 8_500],  // $1,000 -> $20 + $40 + $25
  ])('budget %i cents -> fee %i cents', (budget, fee) => {
    expect(connectorFeeCents(budget)).toBe(fee);
  });
  it('rejects non-positive or fractional cents', () => {
    expect(() => connectorFeeCents(0)).toThrow(RangeError);
    expect(() => connectorFeeCents(12.5)).toThrow(RangeError);
  });
});

describe('quoteJob', () => {
  it('keeps standard pricing identical to quote() for untagged jobs', () => {
    const q = quoteJob({ budgetUsd: 60, title: 'Photograph the YC sign', instructions: '', certification_required: null });
    const s = quote(6_000);
    expect(q).toMatchObject({ pricing: 'standard', budgetCents: 6_000, workerPayCents: s.workerPayCents, feeCents: s.feeCents, chargeCents: 6_000 });
  });
  it('charges the connector fee on top for a legal job; the worker keeps the whole budget', () => {
    const q = quoteJob({ budgetUsd: 200, title: 'Review our SaaS terms of service', instructions: '', certification_required: null });
    expect(q).toMatchObject({ pricing: 'connector', budgetCents: 20_000, workerPayCents: 20_000, feeCents: 3_000, chargeCents: 23_000 });
    expect(q.tags.rules).toEqual(['L2']);
  });
  it('prices a refused-tag job as standard (intake rejects it before payment)', () => {
    const q = quoteJob({ budgetUsd: 80, title: 'Rewire a kitchen outlet', instructions: '', certification_required: null });
    expect(q.tags.forced).toBe('refuse');
    expect(q.pricing).toBe('standard');
  });
  it('enforces the $20 minimum on the budget', () => {
    expect(() => quoteJob({ budgetUsd: 19.99, title: 'Notarize a deed', instructions: '', certification_required: null })).toThrow(/minimum/);
  });
});
