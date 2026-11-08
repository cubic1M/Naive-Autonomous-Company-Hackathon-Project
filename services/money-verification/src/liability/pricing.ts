// services/money-verification/src/liability/pricing.ts
import { MIN_JOB_PRICE_CENTS, quote } from '../pricing.js';
import { tagJob, type JobTags, type Pricing } from './tags.js';

/**
 * Connector platform fee, charged to the customer on top of the budget (the licensed worker keeps the whole
 * budget): 20% of the first $100, 10% of the part from $100 to $500, 5% above $500, rounded half-up to the cent.
 */
export function connectorFeeCents(budgetCents: number): number {
  if (!Number.isInteger(budgetCents) || budgetCents <= 0) {
    throw new RangeError(`budgetCents must be a positive integer, got ${budgetCents}`);
  }
  const tier1 = Math.min(budgetCents, 10_000);
  const tier2 = Math.min(Math.max(budgetCents - 10_000, 0), 40_000);
  const tier3 = Math.max(budgetCents - 50_000, 0);
  const basisPointCents = tier1 * 2_000 + tier2 * 1_000 + tier3 * 500;
  return Math.floor((basisPointCents + 5_000) / 10_000);
}

export interface JobQuote {
  tags: JobTags;
  pricing: Pricing;
  budgetCents: number;
  workerPayCents: number;
  feeCents: number;
  /** What the customer's card is held for: always worker pay plus fee (escrowAmountCents relies on this). */
  chargeCents: number;
}

/** Intake pricing for request_human. Standard pricing is quote() unchanged. */
export function quoteJob(input: { budgetUsd: number; title: string; instructions: string; certification_required: string | null }): JobQuote {
  if (!Number.isFinite(input.budgetUsd)) throw new RangeError(`budget_usd must be a number, got ${input.budgetUsd}`);
  const budgetCents = Math.round(input.budgetUsd * 100);
  if (budgetCents < MIN_JOB_PRICE_CENTS) {
    throw new RangeError(`job price ${budgetCents} is below the ${MIN_JOB_PRICE_CENTS} cent minimum`);
  }
  const tags = tagJob(input);
  if (tags.pricing === 'connector') {
    const feeCents = connectorFeeCents(budgetCents);
    return { tags, pricing: 'connector', budgetCents, workerPayCents: budgetCents, feeCents, chargeCents: budgetCents + feeCents };
  }
  const q = quote(budgetCents);
  return { tags, pricing: 'standard', budgetCents, workerPayCents: q.workerPayCents, feeCents: q.feeCents, chargeCents: q.priceCents };
}
