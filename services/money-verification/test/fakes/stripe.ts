/**
 * In-memory test fake for the Stripe SDK subset this package uses (see src/stripe-client.ts).
 * This is NOT a Stripe emulator: it implements only the narrow StripeClient interface, records every
 * call for assertions, honors idempotency keys the way Stripe does (same key -> same result object),
 * and offers helpers that produce webhook events for the state it holds.
 *
 * Signature verification is REAL: `webhooks` is the official SDK's webhooks object, so tests exercise
 * the same constructEvent that production runs. Use `signHeader(payload, secret)` to sign a body.
 *
 * Drafted by the local model from a written spec; reviewed and corrected by the coordinator.
 */
import Stripe from 'stripe';
import type { StripeClient } from '../../src/stripe-client.js';

type Meta = Record<string, unknown>;

interface FakePI {
  id: string;
  object: 'payment_intent';
  amount: number;
  currency: string;
  status: string;
  capture_method: string;
  transfer_group: string | null;
  metadata: Meta;
  latest_charge: string | null;
  amount_received: number;
  cancellation_reason?: string;
}
interface FakeCS {
  id: string;
  object: 'checkout.session';
  mode: string;
  url: string;
  payment_intent: string;
  metadata: Meta;
  payment_status: string;
  status: string;
  amount_total: number;
  success_url?: string;
  cancel_url?: string;
}
interface FakeAcct {
  id: string;
  object: 'account';
  type: string;
  country: string;
  payouts_enabled: boolean;
  charges_enabled: boolean;
  details_submitted: boolean;
  capabilities: { transfers: string };
  metadata: Meta;
}
interface FakeTr {
  id: string;
  object: 'transfer';
  amount: number;
  currency: string;
  destination: string;
  transfer_group: string | null;
  source_transaction: string | null;
  metadata: Meta;
}
interface FakeRf {
  id: string;
  object: 'refund';
  amount: number;
  currency: string;
  payment_intent: string;
  charge: string | null;
  status: string;
  reason: string | null;
  metadata: Meta;
}
interface FakeDp {
  id: string;
  object: 'dispute';
  charge: string;
  amount: number;
  currency: string;
  status: string;
  reason: string;
  evidence: Record<string, unknown>;
  evidence_details: { due_by: number | null; has_evidence: boolean; submission_count: number };
  payment_intent: string | null;
}

interface FakeVS {
  id: string;
  object: 'identity.verification_session';
  status: 'requires_input' | 'processing' | 'verified' | 'canceled';
  type: string;
  url: string | null;
  client_secret: string | null;
  client_reference_id: string | null;
  created: number;
  livemode: false;
  metadata: Meta;
  options: unknown;
  return_url: string | null;
  last_error: { code: string; reason: string } | null;
  last_verification_report: string | null;
  verified_outputs: Record<string, unknown> | null;
  redaction: null;
  related_customer: null;
}

export interface RecordedCall {
  method: string;
  params: unknown;
  idempotencyKey?: string;
}

export class FakeStripe implements StripeClient {
  readonly calls: RecordedCall[] = [];
  readonly piStore = new Map<string, FakePI>();
  readonly csStore = new Map<string, FakeCS>();
  readonly acctStore = new Map<string, FakeAcct>();
  readonly trStore = new Map<string, FakeTr>();
  readonly rfStore = new Map<string, FakeRf>();
  readonly dpStore = new Map<string, FakeDp>();
  readonly vsStore = new Map<string, FakeVS>();
  /** The real SDK's webhook signature code; `sk_test_fake` is never sent anywhere. */
  readonly webhooks = new Stripe('sk_test_fake').webhooks;

  private readonly idCounters = new Map<string, number>();
  private readonly idempotencyCache = new Map<string, { body: string; result: unknown }>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  callsTo(method: string): RecordedCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  private nextId(prefix: string): string {
    const n = (this.idCounters.get(prefix) ?? 0) + 1;
    this.idCounters.set(prefix, n);
    return `${prefix}_${n}`;
  }

  private record(method: string, params: unknown, options?: Stripe.RequestOptions): void {
    this.calls.push({ method, params, idempotencyKey: options?.idempotencyKey });
  }

  /**
   * Same method + key + params -> the stored result object; no key -> always a fresh object.
   * Same key with DIFFERENT params throws idempotency_error, as real Stripe does, so a test
   * cannot pass a retry sequence that production Stripe would reject.
   */
  private idempotent<T>(method: string, params: unknown, options: Stripe.RequestOptions | undefined, factory: () => T): T {
    const key = options?.idempotencyKey;
    if (key === undefined) return factory();
    const ck = `${method}:${key}`;
    const body = JSON.stringify(canonical(params));
    const cached = this.idempotencyCache.get(ck);
    if (cached !== undefined) {
      if (cached.body !== body) {
        throw new Stripe.errors.StripeIdempotencyError({
          type: 'idempotency_error',
          message: `Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than '${key}' if you meant to execute a different request.`,
        });
      }
      return cached.result as T;
    }
    const result = factory();
    this.idempotencyCache.set(ck, { body, result });
    return result;
  }

  private unix(): number {
    return Math.floor(this.now().getTime() / 1000);
  }

  // ---------------------------------------------------------------- event helpers

  event(type: string, object: unknown): Stripe.Event {
    return {
      id: this.nextId('evt_test'),
      object: 'event',
      type,
      api_version: null,
      created: this.unix(),
      data: { object },
      livemode: false,
      pending_webhooks: 0,
      request: null,
    } as unknown as Stripe.Event;
  }

  signHeader(payload: string, secret: string): string {
    return this.webhooks.generateTestHeaderString({ payload, secret });
  }

  /**
   * Customer paid on the Checkout page: PI becomes capturable (manual) or succeeded (automatic).
   * NOTE: with capture_method 'manual', real Stripe leaves session.payment_status = 'unpaid' until capture,
   * so handlers must not gate on payment_status === 'paid'. The fake mirrors that.
   */
  completeCheckout(sessionId: string): Stripe.Event {
    const cs = this.csStore.get(sessionId);
    if (!cs) throw new Error(`No such checkout session: ${sessionId}`);
    const pi = this.piStore.get(cs.payment_intent);
    let paid = false;
    if (pi) {
      if (pi.capture_method === 'manual') {
        pi.status = 'requires_capture';
      } else {
        pi.status = 'succeeded';
        pi.latest_charge = this.nextId('ch_test');
        pi.amount_received = pi.amount;
        paid = true;
      }
    }
    cs.payment_status = paid ? 'paid' : 'unpaid';
    cs.status = 'complete';
    return this.event('checkout.session.completed', cs);
  }

  /** Stripe (or expireStaleEscrows) canceled the authorization. */
  paymentIntentCanceledEvent(paymentIntentId: string): Stripe.Event {
    const pi = this.piStore.get(paymentIntentId);
    if (!pi) throw new Error(`No such payment intent: ${paymentIntentId}`);
    pi.status = 'canceled';
    return this.event('payment_intent.canceled', pi);
  }

  /** A refund happened outside our code (e.g. the Stripe dashboard): emits charge.refunded for the PI's charge. */
  chargeRefundedEvent(paymentIntentId: string, amountRefunded?: number): Stripe.Event {
    const pi = this.piStore.get(paymentIntentId);
    if (!pi || !pi.latest_charge) throw new Error(`No captured charge for payment intent: ${paymentIntentId}`);
    const refunded = amountRefunded ?? pi.amount;
    const charge = {
      id: pi.latest_charge,
      object: 'charge',
      amount: pi.amount,
      amount_refunded: refunded,
      refunded: refunded >= pi.amount,
      payment_intent: pi.id,
      currency: pi.currency,
      metadata: pi.metadata,
    };
    return this.event('charge.refunded', charge);
  }

  /** Stripe's own record of a refund (ours or a dashboard one), as the refund.created webhook delivers it. */
  refundCreatedEvent(refundId: string): Stripe.Event {
    const rf = this.rfStore.get(refundId);
    if (!rf) throw new Error(`No such refund: ${refundId}`);
    return this.event('refund.created', rf);
  }

  /** Express onboarding finished: payouts enabled. */
  enablePayouts(accountId: string): Stripe.Event {
    const acct = this.acctStore.get(accountId);
    if (!acct) throw new Error(`No such account: ${accountId}`);
    acct.payouts_enabled = true;
    acct.details_submitted = true;
    acct.capabilities.transfers = 'active';
    return this.event('account.updated', acct);
  }

  openDispute(chargeId: string, amountCents: number): Stripe.Event {
    const id = this.nextId('dp_test');
    let piId: string | null = null;
    for (const pi of this.piStore.values()) {
      if (pi.latest_charge === chargeId) {
        piId = pi.id;
        break;
      }
    }
    const dp: FakeDp = {
      id,
      object: 'dispute',
      charge: chargeId,
      amount: amountCents,
      currency: 'usd',
      status: 'needs_response',
      reason: 'fraudulent',
      evidence: {},
      evidence_details: { due_by: this.unix() + 7 * 24 * 3600, has_evidence: false, submission_count: 0 },
      payment_intent: piId,
    };
    this.dpStore.set(id, dp);
    return this.event('charge.dispute.created', dp);
  }

  updateDisputeEvent(disputeId: string, status: string): Stripe.Event {
    const dp = this.dpStore.get(disputeId);
    if (!dp) throw new Error(`No such dispute: ${disputeId}`);
    dp.status = status;
    return this.event('charge.dispute.updated', dp);
  }

  closeDispute(disputeId: string, status: 'won' | 'lost'): Stripe.Event {
    const dp = this.dpStore.get(disputeId);
    if (!dp) throw new Error(`No such dispute: ${disputeId}`);
    dp.status = status;
    return this.event('charge.dispute.closed', dp);
  }

  private verificationSession(sessionId: string): FakeVS {
    const vs = this.vsStore.get(sessionId);
    if (!vs) throw new Error(`No such identity verification session: ${sessionId}`);
    return vs;
  }

  /**
   * The worker passed the document and selfie checks. As observed against the real sandbox (API 2026-10-28), the
   * identity.verification_session.verified payload does NOT carry verified_outputs: it is expandable and only
   * comes back from retrieve(id, { expand: ['verified_outputs'] }). The fake mirrors that.
   */
  identityVerifiedEvent(sessionId: string, outputs: { first_name: string; last_name: string }): Stripe.Event {
    const vs = this.verificationSession(sessionId);
    vs.status = 'verified';
    vs.url = null;
    vs.last_error = null;
    vs.last_verification_report = this.nextId('vr_test');
    vs.verified_outputs = {
      address: null,
      email: null,
      first_name: outputs.first_name,
      last_name: outputs.last_name,
      id_number_type: null,
      phone: null,
    };
    return this.event('identity.verification_session.verified', this.wireSession(vs, false));
  }

  /** The session as the API serialises it: verified_outputs only when expanded. */
  private wireSession(vs: FakeVS, expandOutputs: boolean): Record<string, unknown> {
    const { verified_outputs, ...rest } = vs;
    return expandOutputs ? { ...rest, verified_outputs } : rest;
  }

  /** A check failed and the worker must try again: requires_input with last_error set. */
  identityRequiresInputEvent(
    sessionId: string,
    lastError: { code: string; reason: string } = { code: 'document_unverified_other', reason: 'The document could not be verified.' },
  ): Stripe.Event {
    const vs = this.verificationSession(sessionId);
    vs.status = 'requires_input';
    vs.last_error = lastError;
    return this.event('identity.verification_session.requires_input', vs);
  }

  /** The session was canceled (by us or by Stripe). */
  identityCanceledEvent(sessionId: string): Stripe.Event {
    const vs = this.verificationSession(sessionId);
    vs.status = 'canceled';
    vs.url = null;
    return this.event('identity.verification_session.canceled', vs);
  }

  // ---------------------------------------------------------------- StripeClient

  readonly checkout = {
    sessions: {
      create: async (
        params: Stripe.Checkout.SessionCreateParams,
        options?: Stripe.RequestOptions,
      ): Promise<Stripe.Checkout.Session> => {
        this.record('checkout.sessions.create', params, options);
        return this.idempotent('checkout.sessions.create', params, options, () => {
          const id = this.nextId('cs_test');
          const piId = this.nextId('pi_test');
          const amount_total = (params.line_items ?? []).reduce(
            (s, li) => s + (li.price_data?.unit_amount ?? 0) * (li.quantity ?? 1),
            0,
          );
          const pi: FakePI = {
            id: piId,
            object: 'payment_intent',
            amount: amount_total,
            currency: 'usd',
            status: 'requires_payment_method',
            capture_method: params.payment_intent_data?.capture_method ?? 'automatic',
            transfer_group: params.payment_intent_data?.transfer_group ?? null,
            metadata: (params.payment_intent_data?.metadata ?? {}) as Meta,
            latest_charge: null,
            amount_received: 0,
          };
          this.piStore.set(piId, pi);
          const cs: FakeCS = {
            id,
            object: 'checkout.session',
            mode: params.mode ?? 'payment',
            url: `https://checkout.stripe.test/${id}`,
            payment_intent: piId,
            metadata: (params.metadata ?? {}) as Meta,
            payment_status: 'unpaid',
            status: 'open',
            amount_total,
            success_url: params.success_url,
            cancel_url: params.cancel_url,
          };
          this.csStore.set(id, cs);
          return cs as unknown as Stripe.Checkout.Session;
        });
      },
    },
  };

  readonly paymentIntents = {
    capture: async (
      id: string,
      params?: Stripe.PaymentIntentCaptureParams,
      options?: Stripe.RequestOptions,
    ): Promise<Stripe.PaymentIntent> => {
      this.record('paymentIntents.capture', { id, params }, options);
      return this.idempotent('paymentIntents.capture', { id, params }, options, () => {
        const pi = this.piStore.get(id);
        if (!pi || pi.status !== 'requires_capture') {
          throw new Error(`PaymentIntent ${id} cannot be captured in status ${pi?.status ?? 'unknown'}`);
        }
        pi.status = 'succeeded';
        pi.latest_charge = this.nextId('ch_test');
        pi.amount_received = params?.amount_to_capture ?? pi.amount;
        return pi as unknown as Stripe.PaymentIntent;
      });
    },
    cancel: async (
      id: string,
      params?: Stripe.PaymentIntentCancelParams,
      options?: Stripe.RequestOptions,
    ): Promise<Stripe.PaymentIntent> => {
      this.record('paymentIntents.cancel', { id, params }, options);
      return this.idempotent('paymentIntents.cancel', { id, params }, options, () => {
        const pi = this.piStore.get(id);
        if (!pi || (pi.status !== 'requires_capture' && pi.status !== 'requires_payment_method')) {
          throw new Error(`PaymentIntent ${id} cannot be canceled in status ${pi?.status ?? 'unknown'}`);
        }
        pi.status = 'canceled';
        pi.cancellation_reason = params?.cancellation_reason;
        return pi as unknown as Stripe.PaymentIntent;
      });
    },
  };

  readonly refunds = {
    create: async (params: Stripe.RefundCreateParams, options?: Stripe.RequestOptions): Promise<Stripe.Refund> => {
      this.record('refunds.create', params, options);
      return this.idempotent('refunds.create', params, options, () => {
        const piId = params.payment_intent ?? '';
        const pi = this.piStore.get(piId);
        if (!pi || pi.status !== 'succeeded') {
          throw new Error(`Cannot refund PaymentIntent ${piId}: not succeeded`);
        }
        const id = this.nextId('re_test');
        const rf: FakeRf = {
          id,
          object: 'refund',
          amount: params.amount ?? pi.amount,
          currency: 'usd',
          payment_intent: pi.id,
          charge: pi.latest_charge,
          status: 'succeeded',
          reason: params.reason ?? null,
          metadata: (params.metadata ?? {}) as Meta,
        };
        this.rfStore.set(id, rf);
        return rf as unknown as Stripe.Refund;
      });
    },
  };

  readonly transfers = {
    create: async (params: Stripe.TransferCreateParams, options?: Stripe.RequestOptions): Promise<Stripe.Transfer> => {
      this.record('transfers.create', params, options);
      return this.idempotent('transfers.create', params, options, () => {
        // Real Stripe accepts transfers to accounts whose payouts are not enabled yet (funds wait on the balance).
        const id = this.nextId('tr_test');
        const tr: FakeTr = {
          id,
          object: 'transfer',
          amount: params.amount ?? 0,
          currency: params.currency,
          destination: params.destination,
          transfer_group: params.transfer_group ?? null,
          source_transaction: params.source_transaction ?? null,
          metadata: (params.metadata ?? {}) as Meta,
        };
        this.trStore.set(id, tr);
        return tr as unknown as Stripe.Transfer;
      });
    },
  };

  readonly accounts = {
    create: async (params: Stripe.AccountCreateParams, options?: Stripe.RequestOptions): Promise<Stripe.Account> => {
      this.record('accounts.create', params, options);
      return this.idempotent('accounts.create', params, options, () => {
        const id = this.nextId('acct_test');
        const acct: FakeAcct = {
          id,
          object: 'account',
          type: params.type ?? 'express',
          country: params.country ?? 'US',
          payouts_enabled: false,
          charges_enabled: false,
          details_submitted: false,
          capabilities: { transfers: 'inactive' },
          metadata: (params.metadata ?? {}) as Meta,
        };
        this.acctStore.set(id, acct);
        return acct as unknown as Stripe.Account;
      });
    },
    retrieve: async (id: string, options?: Stripe.RequestOptions): Promise<Stripe.Account> => {
      this.record('accounts.retrieve', { id }, options);
      const acct = this.acctStore.get(id);
      if (!acct) throw new Error(`No such account: ${id}`);
      return acct as unknown as Stripe.Account;
    },
  };

  readonly accountLinks = {
    create: async (params: Stripe.AccountLinkCreateParams, options?: Stripe.RequestOptions): Promise<Stripe.AccountLink> => {
      this.record('accountLinks.create', params, options);
      return this.idempotent('accountLinks.create', params, options, () => {
        const created = this.unix();
        return {
          object: 'account_link',
          url: `https://connect.stripe.test/onboard/${params.account}`,
          created,
          expires_at: created + 300,
        } as unknown as Stripe.AccountLink;
      });
    },
  };

  readonly identity = {
    verificationSessions: {
      create: async (
        params: Stripe.Identity.VerificationSessionCreateParams,
        options?: Stripe.RequestOptions,
      ): Promise<Stripe.Identity.VerificationSession> => {
        this.record('identity.verificationSessions.create', params, options);
        return this.idempotent('identity.verificationSessions.create', params, options, () => {
          const id = this.nextId('vs_test');
          const vs: FakeVS = {
            id,
            object: 'identity.verification_session',
            status: 'requires_input',
            type: params.type ?? 'document',
            url: `https://verify.stripe.test/${id}`,
            client_secret: `${id}_secret`,
            client_reference_id: params.client_reference_id ?? null,
            created: this.unix(),
            livemode: false,
            metadata: (params.metadata ?? {}) as Meta,
            options: params.options ?? null,
            return_url: params.return_url ?? null,
            last_error: null,
            last_verification_report: null,
            verified_outputs: null,
            redaction: null,
            related_customer: null,
          };
          this.vsStore.set(id, vs);
          return vs as unknown as Stripe.Identity.VerificationSession;
        });
      },
      retrieve: async (
        id: string,
        params?: Stripe.Identity.VerificationSessionRetrieveParams,
        options?: Stripe.RequestOptions,
      ): Promise<Stripe.Identity.VerificationSession> => {
        this.record('identity.verificationSessions.retrieve', { id, params }, options);
        const vs = this.verificationSession(id);
        const expand = params?.expand ?? [];
        return this.wireSession(vs, expand.includes('verified_outputs')) as unknown as Stripe.Identity.VerificationSession;
      },
    },
  };

  readonly disputes = {
    update: async (id: string, params: Stripe.DisputeUpdateParams, options?: Stripe.RequestOptions): Promise<Stripe.Dispute> => {
      this.record('disputes.update', { id, params }, options);
      return this.idempotent('disputes.update', { id, params }, options, () => {
        const dp = this.dpStore.get(id);
        if (!dp) throw new Error(`No such dispute: ${id}`);
        if (params.evidence) Object.assign(dp.evidence, params.evidence);
        dp.evidence_details.has_evidence = Object.keys(dp.evidence).length > 0;
        if (params.submit === true) {
          dp.status = 'under_review';
          dp.evidence_details.submission_count += 1;
        }
        return dp as unknown as Stripe.Dispute;
      });
    },
  };
}

/** Key-order-insensitive form of request params, so equal bodies compare equal as in Stripe. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}
