import { describe, expect, it } from 'vitest';
import { FEE_BPS, MIN_JOB_PRICE_CENTS, quote, quoteFromBudgetUsd } from '../src/pricing.js';

describe('pricing constants', () => {
  it('keeps 25% and a $3 minimum', () => {
    expect(FEE_BPS).toBe(2_500);
    expect(MIN_JOB_PRICE_CENTS).toBe(300);
  });
});

describe('quote', () => {
  it('splits the README example: $60 job pays the worker $45 and Operis $15', () => {
    expect(quote(6000)).toEqual({ priceCents: 6000, feeCents: 1500, workerPayCents: 4500, requiresApproval: false });
  });

  it('rejects prices under the minimum and accepts exactly the minimum', () => {
    expect(() => quote(299)).toThrow(RangeError);
    const q = quote(300);
    expect(q.feeCents).toBe(75);
    expect(q.workerPayCents).toBe(225);
  });

  it('rounds the fee half-up', () => {
    expect(quote(2001).feeCents).toBe(500); // 500.25
    expect(quote(2002).feeCents).toBe(501); // 500.5
    expect(quote(2003).feeCents).toBe(501); // 500.75
  });

  it('always has worker + fee === price across a sweep', () => {
    for (let price = 2000; price <= 2100; price++) {
      const q = quote(price);
      expect(q.workerPayCents + q.feeCents).toBe(price);
      expect(q.priceCents).toBe(price);
    }
  });

  it.each([6000.5, 0, -1, -6000, Number.NaN])('rejects invalid price %s with RangeError', (bad) => {
    expect(() => quote(bad)).toThrow(RangeError);
  });

  describe('requiresApproval', () => {
    it('is false when worker pay equals the cap (not strictly greater)', () => {
      const q = quote(20000);
      expect(q.workerPayCents).toBe(15000);
      expect(q.requiresApproval).toBe(false);
    });

    it('is true when worker pay is one cent over the cap', () => {
      const q = quote(20004);
      expect(q.workerPayCents).toBe(15003);
      expect(q.requiresApproval).toBe(true);
    });

    it('honours a custom cap argument', () => {
      expect(quote(6000, 4000).requiresApproval).toBe(true);
      expect(quote(6000, 4500).requiresApproval).toBe(false);
    });
  });
});

describe('quoteFromBudgetUsd', () => {
  it('converts whole dollars', () => {
    expect(quoteFromBudgetUsd(60)).toEqual(quote(6000));
  });

  it('rounds fractional dollars to the nearest cent', () => {
    expect(quoteFromBudgetUsd(59.99).priceCents).toBe(5999);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects %s with RangeError', (bad) => {
    expect(() => quoteFromBudgetUsd(bad)).toThrow(RangeError);
  });

  it('passes a custom payout cap through', () => {
    expect(quoteFromBudgetUsd(60, 4000).requiresApproval).toBe(true);
  });
});
