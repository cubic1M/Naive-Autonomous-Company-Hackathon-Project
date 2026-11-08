import type Stripe from 'stripe';

/**
 * The subset of the Stripe SDK this package uses. The real `new Stripe(key)` instance satisfies it
 * structurally (see `fromStripe`), and tests inject `FakeStripe` from test/fakes/stripe.ts.
 */
export interface StripeClient {
  checkout: {
    sessions: {
      create(
        params: Stripe.Checkout.SessionCreateParams,
        options?: Stripe.RequestOptions,
      ): Promise<Stripe.Checkout.Session>;
    };
  };
  paymentIntents: {
    /** Direct off-session hold against a saved card (agent-payable escrow); Checkout stays the no-card path. */
    create(params: Stripe.PaymentIntentCreateParams, options?: Stripe.RequestOptions): Promise<Stripe.PaymentIntent>;
    capture(
      id: string,
      params?: Stripe.PaymentIntentCaptureParams,
      options?: Stripe.RequestOptions,
    ): Promise<Stripe.PaymentIntent>;
    cancel(
      id: string,
      params?: Stripe.PaymentIntentCancelParams,
      options?: Stripe.RequestOptions,
    ): Promise<Stripe.PaymentIntent>;
  };
  refunds: {
    create(params: Stripe.RefundCreateParams, options?: Stripe.RequestOptions): Promise<Stripe.Refund>;
  };
  transfers: {
    create(params: Stripe.TransferCreateParams, options?: Stripe.RequestOptions): Promise<Stripe.Transfer>;
  };
  accounts: {
    create(params: Stripe.AccountCreateParams, options?: Stripe.RequestOptions): Promise<Stripe.Account>;
    retrieve(id: string, options?: Stripe.RequestOptions): Promise<Stripe.Account>;
  };
  accountLinks: {
    create(params: Stripe.AccountLinkCreateParams, options?: Stripe.RequestOptions): Promise<Stripe.AccountLink>;
  };
  customers: {
    create(params: Stripe.CustomerCreateParams, options?: Stripe.RequestOptions): Promise<Stripe.Customer>;
  };
  setupIntents: {
    /** A setup-mode Checkout session only carries the SetupIntent id; the saved payment_method comes from a retrieve. */
    retrieve(id: string, params?: Stripe.SetupIntentRetrieveParams, options?: Stripe.RequestOptions): Promise<Stripe.SetupIntent>;
  };
  identity: {
    verificationSessions: {
      create(
        params: Stripe.Identity.VerificationSessionCreateParams,
        options?: Stripe.RequestOptions,
      ): Promise<Stripe.Identity.VerificationSession>;
      /** verified_outputs is expandable and absent from webhook payloads: retrieve(id, { expand: ['verified_outputs'] }). */
      retrieve(
        id: string,
        params?: Stripe.Identity.VerificationSessionRetrieveParams,
        options?: Stripe.RequestOptions,
      ): Promise<Stripe.Identity.VerificationSession>;
    };
  };
  disputes: {
    update(id: string, params: Stripe.DisputeUpdateParams, options?: Stripe.RequestOptions): Promise<Stripe.Dispute>;
  };
  webhooks: {
    constructEvent(payload: string | Buffer, header: string | Buffer | string[], secret: string): Stripe.Event;
  };
}

/** Compile-time proof that the official SDK instance is a valid StripeClient. */
export function fromStripe(stripe: Stripe): StripeClient {
  return stripe;
}
