import type { Env } from './env.js';
import { DailyCapExceededError, InvalidStateError, NotFoundError } from './errors.js';
import { fire, type Hooks } from './hooks.js';
import * as ledger from './ledger.js';
import type { Repo } from './repo.js';
import type { StripeClient } from './stripe-client.js';
import type { Escrow, Job } from './types.js';

export interface EscrowDeps {
  stripe: StripeClient;
  repo: Repo;
  env: Pick<Env, 'PUBLIC_BASE_URL' | 'DAILY_ESCROW_CAP_CENTS'>;
  hooks?: Hooks;
  now?: () => Date;
}

/** Card authorizations under manual capture expire after ~7 days for most card networks. */
export const AUTHORIZATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const transferGroup = (jobId: string) => `job:${jobId}`;

export function escrowAmountCents(job: Job): number {
  const total = job.worker_pay_cents + job.fee_cents;
  if (!Number.isInteger(total) || total <= 0) throw new InvalidStateError(`job ${job.id} has invalid amounts`);
  return total;
}

/**
 * Create a Stripe Checkout Session that AUTHORIZES (manual capture) the customer's card for
 * worker_pay + fee, write the escrows row (pending) and an escrow_hold ledger line.
 * Idempotent per job: Stripe idempotency key `escrow:<jobId>` + ledger key `escrow_hold:<jobId>`.
 * Enforces the rolling-24h DAILY_ESCROW_CAP_CENTS using escrow_hold ledger totals.
 */
export async function createEscrow(deps: EscrowDeps, job: Job): Promise<{ url: string; escrow: Escrow }> {
  const now = deps.now?.() ?? new Date();
  const amount = escrowAmountCents(job);
  const existing = await deps.repo.getEscrow(job.id);
  if (existing && existing.status !== 'pending') {
    throw new InvalidStateError(`escrow for job ${job.id} is already ${existing.status}`);
  }
  if (!existing) {
    // listLedger's upper bound is exclusive; +1 ms so a hold written at this same instant still counts.
    const heldToday = await ledger.sumKind(deps.repo, 'escrow_hold', new Date(now.getTime() - DAY_MS), new Date(now.getTime() + 1));
    if (heldToday + amount > deps.env.DAILY_ESCROW_CAP_CENTS) {
      throw new DailyCapExceededError(amount, heldToday, deps.env.DAILY_ESCROW_CAP_CENTS);
    }
  }
  const base = deps.env.PUBLIC_BASE_URL;
  const session = await deps.stripe.checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: amount,
            product_data: { name: `Operis: ${job.task_type} (job ${job.id})` },
          },
        },
      ],
      payment_intent_data: {
        capture_method: 'manual',
        transfer_group: transferGroup(job.id),
        metadata: { job_id: job.id },
      },
      metadata: { job_id: job.id },
      success_url: `${base}/jobs/${job.id}/funded?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/jobs/${job.id}/cancelled`,
    },
    { idempotencyKey: `escrow:${job.id}` },
  );
  if (!session.url) throw new InvalidStateError(`checkout session ${session.id} has no url`);
  const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;

  let escrow: Escrow;
  if (existing) {
    escrow = existing;
  } else {
    escrow = await deps.repo.insertEscrow({
      job_id: job.id,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: pi,
      amount_cents: amount,
      status: 'pending',
      authorization_expires_at: null,
    });
    await ledger.record(deps.repo, {
      jobId: job.id,
      kind: 'escrow_hold',
      amountCents: amount,
      idempotencyKey: `escrow_hold:${job.id}`,
      stripeRef: session.id,
    });
  }
  return { url: session.url, escrow };
}

/** Called by the webhook on checkout.session.completed. */
export async function markAuthorized(
  deps: Pick<EscrowDeps, 'repo' | 'now'>,
  jobId: string,
  paymentIntentId: string,
): Promise<Escrow> {
  const now = deps.now?.() ?? new Date();
  const e = await deps.repo.getEscrow(jobId);
  if (!e) throw new NotFoundError('escrow', jobId);
  if (e.status !== 'pending') return e; // already authorized/captured: idempotent
  return deps.repo.updateEscrow(jobId, {
    status: 'authorized',
    stripe_payment_intent_id: paymentIntentId,
    authorization_expires_at: new Date(now.getTime() + AUTHORIZATION_TTL_MS),
  });
}

/**
 * Capture the authorized PaymentIntent. Idempotent: a captured escrow returns immediately.
 * Returns the captured charge id (stored on the escrow_capture ledger line as stripe_ref so
 * payouts can use it as transfer source_transaction without another Stripe round trip).
 */
export async function captureEscrow(deps: EscrowDeps, jobId: string): Promise<{ escrow: Escrow; chargeId: string | null }> {
  const e = await deps.repo.getEscrow(jobId);
  if (!e) throw new NotFoundError('escrow', jobId);
  if (e.status === 'captured') {
    const line = await deps.repo.getLedgerByKey(`escrow_capture:${jobId}`);
    return { escrow: e, chargeId: line?.stripe_ref ?? null };
  }
  if (e.status !== 'authorized') throw new InvalidStateError(`cannot capture escrow in status ${e.status}`);
  if (!e.stripe_payment_intent_id) throw new InvalidStateError(`escrow ${jobId} has no payment intent`);
  const pi = await deps.stripe.paymentIntents.capture(
    e.stripe_payment_intent_id,
    { amount_to_capture: e.amount_cents },
    { idempotencyKey: `capture:${jobId}` },
  );
  const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id ?? null;
  const updated = await deps.repo.updateEscrow(jobId, { status: 'captured' });
  await ledger.record(deps.repo, {
    jobId,
    kind: 'escrow_capture',
    amountCents: e.amount_cents,
    idempotencyKey: `escrow_capture:${jobId}`,
    stripeRef: chargeId,
  });
  return { escrow: updated, chargeId };
}

/**
 * Release an un-captured hold (cancel the PaymentIntent) for failed/expired/cancelled jobs.
 * A pending escrow with no PaymentIntent yet (customer never paid) is simply marked released.
 */
export async function releaseEscrow(deps: EscrowDeps, jobId: string, reason = 'job_not_completed'): Promise<Escrow> {
  const e = await deps.repo.getEscrow(jobId);
  if (!e) throw new NotFoundError('escrow', jobId);
  if (e.status === 'released') return e;
  if (e.status !== 'pending' && e.status !== 'authorized') {
    throw new InvalidStateError(`cannot release escrow in status ${e.status}; use refund`);
  }
  let ref: string | null = null;
  if (e.stripe_payment_intent_id) {
    const pi = await deps.stripe.paymentIntents.cancel(
      e.stripe_payment_intent_id,
      { cancellation_reason: 'requested_by_customer' },
      { idempotencyKey: `release:${jobId}` },
    );
    ref = pi.id;
  }
  const updated = await deps.repo.updateEscrow(jobId, { status: 'released' });
  await ledger.record(deps.repo, {
    jobId,
    kind: 'escrow_release',
    amountCents: e.amount_cents,
    idempotencyKey: `escrow_release:${jobId}`,
    stripeRef: ref ?? `reason:${reason}`,
  });
  await fire(deps.hooks, 'onEscrowReleased', jobId, 'released');
  return updated;
}

/** Called by the webhook on payment_intent.canceled (e.g. authorization expired at Stripe). */
export async function markReleased(deps: Pick<EscrowDeps, 'repo' | 'hooks'>, jobId: string): Promise<Escrow> {
  const e = await deps.repo.getEscrow(jobId);
  if (!e) throw new NotFoundError('escrow', jobId);
  if (e.status === 'released' || e.status === 'refunded') return e;
  const updated = await deps.repo.updateEscrow(jobId, { status: 'released' });
  await ledger.record(deps.repo, {
    jobId,
    kind: 'escrow_release',
    amountCents: e.amount_cents,
    idempotencyKey: `escrow_release:${jobId}`,
    stripeRef: e.stripe_payment_intent_id,
  });
  await fire(deps.hooks, 'onEscrowReleased', jobId, 'released');
  return updated;
}

/** Full refund of a CAPTURED escrow. Idempotent via `refund:<jobId>`. */
export async function refund(deps: EscrowDeps, jobId: string, reason: string): Promise<Escrow> {
  const e = await deps.repo.getEscrow(jobId);
  if (!e) throw new NotFoundError('escrow', jobId);
  if (e.status === 'refunded') return e;
  if (e.status !== 'captured') throw new InvalidStateError(`cannot refund escrow in status ${e.status}; use release`);
  if (!e.stripe_payment_intent_id) throw new InvalidStateError(`escrow ${jobId} has no payment intent`);
  const r = await deps.stripe.refunds.create(
    {
      payment_intent: e.stripe_payment_intent_id,
      reason: 'requested_by_customer',
      metadata: { job_id: jobId, standin_reason: reason.slice(0, 500) },
    },
    { idempotencyKey: `refund:${jobId}` },
  );
  const updated = await deps.repo.updateEscrow(jobId, { status: 'refunded' });
  await ledger.record(deps.repo, {
    jobId,
    kind: 'refund',
    amountCents: r.amount,
    idempotencyKey: `refund:${jobId}`,
    stripeRef: r.id,
  });
  await fire(deps.hooks, 'onEscrowReleased', jobId, 'refunded');
  return updated;
}

/** Called by the webhook on charge.refunded (refund issued from the Stripe dashboard, for instance). */
export async function markRefunded(
  deps: Pick<EscrowDeps, 'repo' | 'hooks'>,
  jobId: string,
  amountCents: number,
  stripeRef: string,
): Promise<Escrow> {
  const e = await deps.repo.getEscrow(jobId);
  if (!e) throw new NotFoundError('escrow', jobId);
  const updated = e.status === 'refunded' ? e : await deps.repo.updateEscrow(jobId, { status: 'refunded' });
  await ledger.record(deps.repo, {
    jobId,
    kind: 'refund',
    amountCents,
    idempotencyKey: `refund:${jobId}`,
    stripeRef,
  });
  if (e.status !== 'refunded') await fire(deps.hooks, 'onEscrowReleased', jobId, 'refunded');
  return updated;
}

/**
 * Release every authorized escrow whose card authorization has expired (authorization_expires_at <= now).
 * Run from a cron/scheduled task. Returns the released job ids.
 */
export async function expireStaleEscrows(deps: EscrowDeps, now: Date = deps.now?.() ?? new Date()): Promise<string[]> {
  const authorized = await deps.repo.listEscrowsByStatus('authorized');
  const released: string[] = [];
  for (const e of authorized) {
    if (e.authorization_expires_at && e.authorization_expires_at.getTime() <= now.getTime()) {
      await releaseEscrow(deps, e.job_id, 'authorization_expired');
      released.push(e.job_id);
    }
  }
  return released;
}
