import type { Repo } from './repo.js';
import type { LedgerEntry, LedgerKind } from './types.js';

export interface LedgerWrite {
  jobId: string | null;
  kind: LedgerKind;
  amountCents: number;
  idempotencyKey: string;
  stripeRef?: string | null;
  currency?: string;
}

/**
 * Append-only ledger write. The idempotency key makes repeats a no-op (the existing row is returned).
 * Amounts are positive integers; `kind` carries the direction (see pnl()).
 */
export async function record(repo: Repo, w: LedgerWrite): Promise<{ inserted: boolean; entry: LedgerEntry }> {
  if (!Number.isInteger(w.amountCents) || w.amountCents < 0) {
    throw new RangeError(`ledger amount must be a non-negative integer, got ${w.amountCents}`);
  }
  return repo.insertLedger({
    job_id: w.jobId,
    kind: w.kind,
    amount_cents: w.amountCents,
    currency: w.currency ?? 'usd',
    stripe_ref: w.stripeRef ?? null,
    idempotency_key: w.idempotencyKey,
  });
}

export interface Pnl {
  feesCents: number;
  payoutsCents: number;
  refundsCents: number;
  /** stripe_cost + kyc_cost + dispute_loss */
  costsCents: number;
  /** fees - refunds - costs. Payouts are pass-through (funded by the customer's charge), not margin. */
  grossMarginCents: number;
  jobsPaid: number;
}

export async function pnl(repo: Repo, range: { from?: Date; to?: Date }): Promise<Pnl> {
  const rows = await repo.listLedger({ from: range.from, to: range.to });
  const sum = (kinds: LedgerKind[]) =>
    rows.filter((r) => kinds.includes(r.kind)).reduce((acc, r) => acc + r.amount_cents, 0);
  const feesCents = sum(['fee']);
  const payoutsCents = sum(['payout']);
  const refundsCents = sum(['refund']);
  const costsCents = sum(['stripe_cost', 'kyc_cost', 'dispute_loss']);
  return {
    feesCents,
    payoutsCents,
    refundsCents,
    costsCents,
    grossMarginCents: feesCents - refundsCents - costsCents,
    jobsPaid: rows.filter((r) => r.kind === 'payout').length,
  };
}

/** Sum of a ledger kind inside [from, to). Used for the daily escrow cap. */
export async function sumKind(repo: Repo, kind: LedgerKind, from: Date, to: Date): Promise<number> {
  const rows = await repo.listLedger({ kind, from, to });
  return rows.reduce((acc, r) => acc + r.amount_cents, 0);
}
