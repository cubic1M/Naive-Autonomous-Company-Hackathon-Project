import type Stripe from 'stripe';
import { idOf } from './disputes.js';
import type { Env } from './env.js';
import { InvalidStateError, NotFoundError } from './errors.js';
import type { Repo } from './repo.js';
import type { StripeClient } from './stripe-client.js';
import type { CustomerPayment } from './types.js';

export interface CustomerPaymentDeps {
  stripe: StripeClient;
  repo: Repo;
  env: Pick<Env, 'PUBLIC_BASE_URL'>;
}

async function requireCustomer(repo: Repo, customerId: string): Promise<CustomerPayment> {
  const customer = await repo.getCustomerPayment(customerId);
  if (!customer) throw new NotFoundError('customer', customerId);
  return customer;
}

/**
 * The Stripe Customer that holds the saved card: created on first use (idempotency key `customer:<id>`) and persisted
 * on customers.stripe_customer_id. Email and name go along when the customers row has them, so receipts and the
 * dashboard show whose agent it is.
 */
export async function ensureStripeCustomer(
  deps: Pick<CustomerPaymentDeps, 'stripe' | 'repo'>,
  customerId: string,
): Promise<{ stripeCustomerId: string; customer: CustomerPayment }> {
  const customer = await requireCustomer(deps.repo, customerId);
  if (customer.stripe_customer_id) return { stripeCustomerId: customer.stripe_customer_id, customer };
  const created = await deps.stripe.customers.create(
    {
      ...(customer.email ? { email: customer.email } : {}),
      ...(customer.name ? { name: customer.name } : {}),
      metadata: { operis_customer_id: customerId },
    },
    { idempotencyKey: `customer:${customerId}` },
  );
  await deps.repo.setCustomerPayment(customerId, { stripe_customer_id: created.id });
  return { stripeCustomerId: created.id, customer: { ...customer, stripe_customer_id: created.id } };
}

/**
 * Setup-mode Checkout session that saves a card on the customer's Stripe Customer for off-session holds; the
 * checkout.session.completed webhook (mode setup) stores the PaymentMethod. Idempotent per customer AND current card
 * (`payment_setup:<id>:<pm|none>`): a retry gets the same session, a customer replacing a saved card gets a new one.
 */
export async function createPaymentSetupLink(
  deps: CustomerPaymentDeps,
  customerId: string,
): Promise<{ url: string; stripeCustomerId: string; sessionId: string }> {
  const { stripeCustomerId, customer } = await ensureStripeCustomer(deps, customerId);
  const base = deps.env.PUBLIC_BASE_URL;
  const session = await deps.stripe.checkout.sessions.create(
    {
      mode: 'setup',
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      metadata: { customer_id: customerId },
      setup_intent_data: { metadata: { customer_id: customerId } },
      success_url: `${base}/customers/${customerId}/payment/done?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/customers/${customerId}/payment/cancelled`,
    },
    { idempotencyKey: `payment_setup:${customerId}:${customer.default_payment_method_id ?? 'none'}` },
  );
  if (!session.url) throw new InvalidStateError(`checkout session ${session.id} has no url`);
  return { url: session.url, stripeCustomerId, sessionId: session.id };
}

/**
 * checkout.session.completed in setup mode: the saved PaymentMethod becomes the customer's default. The event carries
 * the SetupIntent id only, so the method comes from a retrieve. Returns null when the session is not an Operis payment
 * setup (no customer_id metadata) or saved nothing. Idempotent: a redelivery stores the same values.
 */
export async function recordSavedPaymentMethod(
  deps: Pick<CustomerPaymentDeps, 'stripe' | 'repo'>,
  session: Stripe.Checkout.Session,
): Promise<{ customerId: string; paymentMethodId: string } | null> {
  const customerId = session.metadata?.customer_id;
  const setupIntentId = idOf(session.setup_intent);
  if (!customerId || !setupIntentId) return null;
  const setupIntent = await deps.stripe.setupIntents.retrieve(setupIntentId);
  const paymentMethodId = idOf(setupIntent.payment_method);
  if (!paymentMethodId) return null;
  const stripeCustomerId = idOf(session.customer) ?? idOf(setupIntent.customer);
  await deps.repo.setCustomerPayment(customerId, {
    default_payment_method_id: paymentMethodId,
    ...(stripeCustomerId ? { stripe_customer_id: stripeCustomerId } : {}),
  });
  return { customerId, paymentMethodId };
}
