import { DEFAULT_PAYOUT_CAP_CENTS } from './env.js';

export const FEE_BPS = 2_500; // Operis keeps 25% OF THE JOB PRICE; the worker gets 75%
export const MIN_JOB_PRICE_CENTS = 300; // $3 minimum job (lowered from $20 on Nov 8)

export interface Quote {
  priceCents: number;
  workerPayCents: number;
  feeCents: number;
  /** true when workerPayCents exceeds the per-job payout cap; payout then needs release_payout_large. */
  requiresApproval: boolean;
}

/**
 * quote(priceCents): fee = 25% of the job price, rounded HALF UP to the nearest cent
 * (integer math: floor((price * 2500 + 5000) / 10000)); worker pay = price - fee.
 * README example: $60 job -> worker $45, Operis $15. Prices under MIN_JOB_PRICE_CENTS are rejected.
 */
export function quote(priceCents: number, payoutCapCents: number = DEFAULT_PAYOUT_CAP_CENTS): Quote {
  if (!Number.isInteger(priceCents) || priceCents <= 0) {
    throw new RangeError(`priceCents must be a positive integer, got ${priceCents}`);
  }
  if (priceCents < MIN_JOB_PRICE_CENTS) {
    throw new RangeError(`job price ${priceCents} is below the ${MIN_JOB_PRICE_CENTS} cent minimum`);
  }
  const feeCents = Math.floor((priceCents * FEE_BPS + 5_000) / 10_000);
  const workerPayCents = priceCents - feeCents;
  return { priceCents, workerPayCents, feeCents, requiresApproval: workerPayCents > payoutCapCents };
}

/** Boundary conversion for request_human's `budget_usd` (may be fractional, e.g. 59.99). */
export function quoteFromBudgetUsd(budgetUsd: number, payoutCapCents?: number): Quote {
  if (!Number.isFinite(budgetUsd)) throw new RangeError(`budget_usd must be a number, got ${budgetUsd}`);
  return quote(Math.round(budgetUsd * 100), payoutCapCents);
}
