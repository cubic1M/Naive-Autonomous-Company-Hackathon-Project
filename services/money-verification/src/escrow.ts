import type Stripe from 'stripe';
import type { Env } from './env.js';
import { DailyCapExceededError, InvalidStateError, NotFoundError, RequiresApprovalError } from './errors.js';
import { fire, type Hooks } from './hooks.js';
import * as ledger from './ledger.js';
import type { Repo } from './repo.js';
import type { StripeClient } from './stripe-client.js';
import type { Escrow, Job, LedgerEntry } from './types.js';

export interface EscrowDeps {
  stripe: StripeClient;
  repo: Repo;
  env: Pick<Env, 'PUBLIC_BASE_URL' | 'DAILY_ESCROW_CAP_CENTS' | 'PAYOUT_CAP_CENTS'>;
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

export interface CreateEscrowOptions {
  /** Stripe PaymentMethod id (pm_...) the customer agent passed with the request. Wins over the card on file. */
  paymentMethod?: string;
}

export interface EscrowResult {
  /** Checkout URL for someone to pay at, or null when the card was authorized in this call. */
  url: string | null;
  escrow: Escrow;
  /** The card is authorized: the job can move to `held` now, without waiting for a webhook. */
  funded: boolean;
  /**
   * Set when an instrument was available but Checkout had to be used: the Stripe card error code (card_declined,
   * authentication_required, expired_card, ...), invalid_payment_method, or an unexpected PaymentIntent status.
   */
  fallback_reason?: string;
}

interface Instrument {
  paymentMethod: string;
  /** The Stripe Customer the saved method is attached to; a method passed in the call is charged on its own. */
  customer?: string;
}

/** The instrument that can fund the job without Checkout: the one passed in the call, else the requester's card on file. */
async function chooseInstrument(repo: Repo, job: Job, opts: CreateEscrowOptions): Promise<Instrument | null> {
  if (opts.paymentMethod) return { paymentMethod: opts.paymentMethod };
  const c = await repo.getCustomerPaymentForJob(job.id);
  if (!c?.default_payment_method_id) return null;
  return { paymentMethod: c.default_payment_method_id, ...(c.stripe_customer_id ? { customer: c.stripe_customer_id } : {}) };
}

/**
 * Why: a declined, unauthenticated or unknown card is the customer's to fix, and Checkout lets a human do that;
 * every other failure (our params, Stripe down, rate limits) must surface, or the caller would hand out a Checkout
 * link for a problem that is ours.
 */
function checkoutFallbackReason(err: unknown): string | null {
  const e = err as { rawType?: string; code?: string; param?: string };
  if (e.rawType === 'card_error') return e.code ?? 'card_error';
  if (e.rawType === 'invalid_request_error' && (e.param === 'payment_method' || e.code === 'resource_missing')) {
    return 'invalid_payment_method';
  }
  return null;
}

type DirectHold = { ok: true; paymentIntent: Stripe.PaymentIntent } | { ok: false; reason: string };

/**
 * Authorize worker_pay + fee on the instrument: off-session, confirmed at once, manual capture. A Stripe idempotency
 * key is bound to one endpoint, so this one is `escrow:<jobId>:pi`; `escrow:<jobId>` stays with the Checkout session
 * that may follow a decline.
 */
async function authorizeDirect(deps: EscrowDeps, job: Job, amount: number, instrument: Instrument): Promise<DirectHold> {
  try {
    const pi = await deps.stripe.paymentIntents.create(
      {
        amount,
        currency: 'usd',
        payment_method_types: ['card'],
        payment_method: instrument.paymentMethod,
        ...(instrument.customer ? { customer: instrument.customer } : {}),
        off_session: true,
        confirm: true,
        capture_method: 'manual',
        transfer_group: transferGroup(job.id),
        metadata: { job_id: job.id },
        description: `Operis: ${job.task_type} (job ${job.id})`,
      },
      { idempotencyKey: `escrow:${job.id}:pi` },
    );
    return pi.status === 'requires_capture' ? { ok: true, paymentIntent: pi } : { ok: false, reason: pi.status };
  } catch (err) {
    const reason = checkoutFallbackReason(err);
    if (reason === null) throw err;
    return { ok: false, reason };
  }
}

/** A direct hold is already an authorization: the row starts `authorized`, exactly as markAuthorized leaves a Checkout one. */
async function recordDirectHold(deps: EscrowDeps, job: Job, amount: number, pi: Stripe.PaymentIntent, now: Date): Promise<EscrowResult> {
  const escrow = await deps.repo.insertEscrow({
    job_id: job.id,
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: pi.id,
    amount_cents: amount,
    status: 'authorized',
    authorization_expires_at: new Date(now.getTime() + AUTHORIZATION_TTL_MS),
  });
  await ledger.record(deps.repo, {
    jobId: job.id,
    kind: 'escrow_hold',
    amountCents: amount,
    idempotencyKey: `escrow_hold:${job.id}`,
    stripeRef: pi.id,
  });
  await fire(deps.hooks, 'onJobFunded', job.id);
  return { url: null, escrow, funded: true };
}

/**
 * Fund a job: hold worker_pay + fee on the customer's card (manual capture), write the escrows row and the
 * escrow_hold ledger line.
 *
 * With an instrument (payment_method passed in the call, else the customer's card on file) the hold is placed
 * directly and the job is funded when this returns (`url: null, funded: true`; the row starts `authorized`).
 * Without one, or when the instrument is declined, needs authentication or is unknown (`fallback_reason`), a
 * Checkout Session is created for a human to pay and the webhook funds the job later (row `pending`).
 * Enforces the rolling-24h DAILY_ESCROW_CAP_CENTS on every new hold, before any Stripe call.
 * Idempotent per job: a retry of a direct hold returns the authorized escrow without calling Stripe; a pending
 * Checkout escrow returns its session again (Stripe key `escrow:<jobId>`) and is not upgraded to a direct hold;
 * the ledger key is `escrow_hold:<jobId>` either way.
 */
export async function createEscrow(deps: EscrowDeps, job: Job, opts: CreateEscrowOptions = {}): Promise<EscrowResult> {
  const now = deps.now?.() ?? new Date();
  const amount = escrowAmountCents(job);
  const existing = await deps.repo.getEscrow(job.id);
  if (existing?.status === 'authorized' && !existing.stripe_checkout_session_id) {
    return { url: null, escrow: existing, funded: true }; // direct hold already placed; the caller lost the answer
  }
  if (existing && existing.status !== 'pending') {
    throw new InvalidStateError(`escrow for job ${job.id} is already ${existing.status}`);
  }
  let fallback: string | undefined;
  if (!existing) {
    // listLedger's upper bound is exclusive; +1 ms so a hold written at this same instant still counts.
    const heldToday = await ledger.sumKind(deps.repo, 'escrow_hold', new Date(now.getTime() - DAY_MS), new Date(now.getTime() + 1));
    if (heldToday + amount > deps.env.DAILY_ESCROW_CAP_CENTS) {
      throw new DailyCapExceededError(amount, heldToday, deps.env.DAILY_ESCROW_CAP_CENTS);
    }
    const instrument = await chooseInstrument(deps.repo, job, opts);
    if (instrument) {
      const hold = await authorizeDirect(deps, job, amount, instrument);
      if (hold.ok) return recordDirectHold(deps, job, amount, hold.paymentIntent, now);
      fallback = hold.reason;
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
  return { url: session.url, escrow, funded: false, ...(fallback ? { fallback_reason: fallback } : {}) };
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

export interface RefundResult {
  escrow: Escrow;
  /** Cents refunded by THIS call (0 when the escrow was already fully refunded). */
  refundCents: number;
  /** Cents refunded on the job so far, across all refunds. */
  refundedTotalCents: number;
  fullyRefunded: boolean;
  stripeRefundId: string | null;
}

/** Sum of the job's refund ledger lines: the source of truth for "how much has already gone back". */
async function refundedSoFar(repo: Repo, jobId: string): Promise<{ total: number; lines: number }> {
  const rows = await repo.listLedger({ jobId, kind: 'refund' });
  return { total: rows.reduce((acc, r) => acc + r.amount_cents, 0), lines: rows.length };
}

/** Why: an agent-chosen amount must never exceed what is left, or Stripe would be the only guard. */
function checkRefundAmount(amount: number, remaining: number): void {
  if (!Number.isInteger(amount) || amount <= 0) throw new InvalidStateError(`refund amount must be a positive integer of cents, got ${amount}`);
  if (amount > remaining) throw new InvalidStateError(`refund of ${amount} cents exceeds the ${remaining} cents still refundable`);
}

/**
 * Ledger key for ONE Stripe refund, derivable by both writers: the tool (once Stripe has answered) and the
 * refund.created webhook (from the Refund object). Tool refunds carry their request_id in Stripe metadata, so
 * both sides compute the same key and the ledger's unique index makes the second writer a no-op, in either order.
 * Refunds made outside the tool (dashboard, CLI) have no request_id and are keyed by Stripe's refund id.
 */
export function refundLedgerKey(jobId: string, refund: { id: string; metadata?: Stripe.Metadata | null }): string {
  const requestId = refund.metadata?.request_id;
  return requestId ? `refund:${jobId}:req:${requestId}` : `refund:${jobId}:${refund.id}`;
}

/** Why: lets a request-keyed refund recognise its own earlier, completed run before any check or Stripe call. */
async function findRefundLine(repo: Repo, jobId: string, key: string): Promise<LedgerEntry | undefined> {
  return (await repo.listLedger({ jobId, kind: 'refund' })).find((l) => l.idempotency_key === key);
}

/**
 * Why: both refund paths (tool and webhook) can complete the full refund; re-reading the row lets the later one see
 * the earlier one's flip and skip the hook. Best effort, not exactly-once: Repo has no compare-and-set, so a flip
 * landing between the re-read and the update can still fire twice. Hooks are at-least-once and must be idempotent.
 */
async function finishFullRefund(deps: Pick<EscrowDeps, 'repo' | 'hooks'>, escrow: Escrow): Promise<Escrow> {
  const current = (await deps.repo.getEscrow(escrow.job_id)) ?? escrow;
  if (current.status === 'refunded') return current;
  const updated = await deps.repo.updateEscrow(escrow.job_id, { status: 'refunded' });
  await fire(deps.hooks, 'onEscrowReleased', escrow.job_id, 'refunded');
  return updated;
}

/**
 * Refund a CAPTURED escrow, in full (default) or partially (`amountCents`). Several partial refunds may add up to the
 * charge. A job's refunds in total above PAYOUT_CAP_CENTS throw RequiresApprovalError unless `allowLarge` (the CEO
 * agent's approval through refund_large). The job only moves to `refunded` once the whole charge is back; a partial
 * refund leaves it `captured` and fires no hook.
 *
 * Idempotency. Stripe key: `refund:<jobId>:req:<requestId>`, or `refund:<jobId>:<n>` (n = refund lines so far) for
 * direct callers without a request id. Ledger key: refundLedgerKey(), the same key the refund.created webhook derives,
 * so the two writers never double count. With a requestId a replay returns the original refund without calling Stripe;
 * without one an identical repeat IS a second refund. No free text goes to Stripe: a reworded `reason` on retry would
 * otherwise turn the replay into an idempotency_error. The reason lives in the tool-call log and on the board card.
 */
export async function refund(
  deps: EscrowDeps,
  jobId: string,
  reason: string,
  opts: { amountCents?: number; allowLarge?: boolean; requestId?: string } = {},
): Promise<RefundResult> {
  void reason; // kept for callers and logs; deliberately not sent to Stripe (see above)
  const e = await deps.repo.getEscrow(jobId);
  if (!e) throw new NotFoundError('escrow', jobId);
  const before = await refundedSoFar(deps.repo, jobId);
  const requestKey = opts.requestId ? `refund:${jobId}:req:${opts.requestId}` : null;
  // Replay of a completed request: answer from the ledger before the remaining/cap checks, which the first run changed.
  const prior = requestKey ? await findRefundLine(deps.repo, jobId, requestKey) : undefined;
  if (prior) {
    const fullyRefunded = before.total >= e.amount_cents;
    return { escrow: e, refundCents: prior.amount_cents, refundedTotalCents: before.total, fullyRefunded, stripeRefundId: prior.stripe_ref ?? null };
  }

  if (e.status === 'refunded') {
    return { escrow: e, refundCents: 0, refundedTotalCents: before.total, fullyRefunded: true, stripeRefundId: null };
  }
  if (e.status !== 'captured') throw new InvalidStateError(`cannot refund escrow in status ${e.status}; use release`);
  if (!e.stripe_payment_intent_id) throw new InvalidStateError(`escrow ${jobId} has no payment intent`);

  const remaining = e.amount_cents - before.total;
  const amount = opts.amountCents ?? remaining;
  checkRefundAmount(amount, remaining);
  const cap = deps.env.PAYOUT_CAP_CENTS;
  // Cumulative per job, like the single-shot payout: a per-call test would let a job be refunded in <= cap chunks unapproved.
  const refundedAfter = before.total + amount;
  if (refundedAfter > cap && !opts.allowLarge) throw new RequiresApprovalError(refundedAfter, cap, 'refund');

  const r = await deps.stripe.refunds.create(
    {
      payment_intent: e.stripe_payment_intent_id,
      amount,
      reason: 'requested_by_customer',
      metadata: { job_id: jobId, ...(opts.requestId ? { request_id: opts.requestId } : {}) },
    },
    { idempotencyKey: requestKey ?? `refund:${jobId}:${before.lines}` },
  );
  await ledger.record(deps.repo, { jobId, kind: 'refund', amountCents: r.amount, idempotencyKey: refundLedgerKey(jobId, r), stripeRef: r.id });
  // Always re-read: the webhook may have written lines during the Stripe round trip, so `before` is stale.
  const total = (await refundedSoFar(deps.repo, jobId)).total;
  const fullyRefunded = total >= e.amount_cents;
  const escrow = fullyRefunded ? await finishFullRefund(deps, e) : e;
  return { escrow, refundCents: r.amount, refundedTotalCents: total, fullyRefunded, stripeRefundId: r.id };
}

/**
 * refund.created / refund.updated: one ledger line per Stripe refund under refundLedgerKey(), so a refund made through
 * the tool and echoed by Stripe counts once in either order, and a dashboard or CLI refund (never seen by the tool)
 * still reaches the ledger. Returns null when the refund belongs to no escrow of ours.
 */
export async function recordStripeRefund(deps: Pick<EscrowDeps, 'repo' | 'hooks'>, refund: Stripe.Refund): Promise<Escrow | null> {
  const piId = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id ?? null;
  const e = piId ? await deps.repo.getEscrowByPaymentIntent(piId) : null;
  if (!e) return null;
  if (refund.status === 'failed' || refund.status === 'canceled') return e; // no money moved
  await ledger.record(deps.repo, {
    jobId: e.job_id,
    kind: 'refund',
    amountCents: refund.amount,
    idempotencyKey: refundLedgerKey(e.job_id, refund),
    stripeRef: refund.id,
  });
  const { total } = await refundedSoFar(deps.repo, e.job_id);
  return total >= e.amount_cents ? finishFullRefund(deps, e) : e;
}

/**
 * charge.refunded carries the CUMULATIVE amount_refunded. Ledger lines come from refund.created (one per refund); this
 * only reconciles the escrow status, so the webhook never writes a line the tool also writes. A ledger behind Stripe
 * here means refund.created was not delivered (not subscribed, or not yet): logged, never patched, because a delta
 * line would race the tool's own write for the same refund.
 */
export async function markRefunded(
  deps: Pick<EscrowDeps, 'repo' | 'hooks'>,
  jobId: string,
  amountRefundedCumulative: number,
  stripeRef: string,
): Promise<Escrow> {
  const e = await deps.repo.getEscrow(jobId);
  if (!e) throw new NotFoundError('escrow', jobId);
  const { total } = await refundedSoFar(deps.repo, jobId);
  if (total < amountRefundedCumulative) {
    console.warn(
      `[money-verification] job ${jobId}: Stripe reports ${amountRefundedCumulative} cents refunded on ${stripeRef} but the ledger has ${total}; is the webhook endpoint subscribed to refund.created?`,
    );
  }
  return amountRefundedCumulative >= e.amount_cents ? finishFullRefund(deps, e) : e;
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
