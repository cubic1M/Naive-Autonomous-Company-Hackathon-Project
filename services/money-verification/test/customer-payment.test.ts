import { describe, expect, it } from 'vitest';
import { createPaymentSetupLink } from '../src/customer-payment.js';
import { NotFoundError } from '../src/errors.js';
import { InMemoryRepo } from '../src/repo/memory.js';
import { CUSTOMER_ID, makeWorld } from './helpers.js';

const noCard = { customer_id: CUSTOMER_ID, name: 'Acme Agent', email: 'ops@acme.test', stripe_customer_id: null, default_payment_method_id: null };

describe('InMemoryRepo: customers', () => {
  it('getCustomerPayment is null for an unknown customer and returns the seeded row otherwise', async () => {
    const repo = new InMemoryRepo();
    expect(await repo.getCustomerPayment(CUSTOMER_ID)).toBeNull();
    repo.seedCustomer(noCard);
    expect(await repo.getCustomerPayment(CUSTOMER_ID)).toMatchObject({ customer_id: CUSTOMER_ID, stripe_customer_id: null });
  });

  it('getCustomerPaymentForJob follows the job to its customer, null for an unlinked job', async () => {
    const repo = new InMemoryRepo();
    repo.seedCustomer({ ...noCard, default_payment_method_id: 'pm_1' });
    expect(await repo.getCustomerPaymentForJob('job-1')).toBeNull();
    repo.linkJobToCustomer('job-1', CUSTOMER_ID);
    expect(await repo.getCustomerPaymentForJob('job-1')).toMatchObject({ customer_id: CUSTOMER_ID, default_payment_method_id: 'pm_1' });
  });

  it('setCustomerPayment merges only the given fields', async () => {
    const repo = new InMemoryRepo();
    repo.seedCustomer({ ...noCard, stripe_customer_id: 'cus_1' });
    await repo.setCustomerPayment(CUSTOMER_ID, { default_payment_method_id: 'pm_1' });
    expect(await repo.getCustomerPayment(CUSTOMER_ID)).toMatchObject({ stripe_customer_id: 'cus_1', default_payment_method_id: 'pm_1' });
    await expect(repo.setCustomerPayment('missing', { stripe_customer_id: 'cus_2' })).rejects.toThrow(/not found/);
  });
});

describe('createPaymentSetupLink', () => {
  it('creates the Stripe Customer on first use, stores it, and returns a setup-mode Checkout link', async () => {
    const world = makeWorld();
    world.repo.seedCustomer(noCard);
    const r = await createPaymentSetupLink(world.deps, CUSTOMER_ID);

    const cust = world.stripe.callsTo('customers.create');
    expect(cust).toHaveLength(1);
    expect(cust[0]?.params).toEqual({ email: 'ops@acme.test', name: 'Acme Agent', metadata: { operis_customer_id: CUSTOMER_ID } });
    expect(cust[0]?.idempotencyKey).toBe(`customer:${CUSTOMER_ID}`);
    expect(r.stripeCustomerId).toMatch(/^cus_test_/);
    expect((await world.repo.getCustomerPayment(CUSTOMER_ID))?.stripe_customer_id).toBe(r.stripeCustomerId);

    const cs = world.stripe.callsTo('checkout.sessions.create');
    expect(cs).toHaveLength(1);
    expect(cs[0]?.params).toMatchObject({
      mode: 'setup',
      customer: r.stripeCustomerId,
      payment_method_types: ['card'],
      metadata: { customer_id: CUSTOMER_ID },
      setup_intent_data: { metadata: { customer_id: CUSTOMER_ID } },
      success_url: `${world.env.PUBLIC_BASE_URL}/customers/${CUSTOMER_ID}/payment/done?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${world.env.PUBLIC_BASE_URL}/customers/${CUSTOMER_ID}/payment/cancelled`,
    });
    expect(cs[0]?.idempotencyKey).toBe(`payment_setup:${CUSTOMER_ID}:none`);
    expect(r.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    expect(r.sessionId).toMatch(/^cs_test_/);
  });

  it('reuses the stored Stripe Customer and returns the same session on a second call', async () => {
    const world = makeWorld();
    world.repo.seedCustomer(noCard);
    const a = await createPaymentSetupLink(world.deps, CUSTOMER_ID);
    const b = await createPaymentSetupLink(world.deps, CUSTOMER_ID);
    expect(world.stripe.callsTo('customers.create')).toHaveLength(1);
    expect(b.url).toBe(a.url);
    expect(b.stripeCustomerId).toBe(a.stripeCustomerId);
    expect(world.stripe.csStore.size).toBe(1);
  });

  it('a customer with a saved card gets a session keyed on that card, so a replacement card can be set up', async () => {
    const world = makeWorld();
    world.repo.seedCustomer({ ...noCard, stripe_customer_id: 'cus_1', default_payment_method_id: 'pm_old' });
    await createPaymentSetupLink(world.deps, CUSTOMER_ID);
    expect(world.stripe.callsTo('customers.create')).toHaveLength(0);
    const cs = world.stripe.callsTo('checkout.sessions.create')[0];
    expect(cs?.params).toMatchObject({ mode: 'setup', customer: 'cus_1' });
    expect(cs?.idempotencyKey).toBe(`payment_setup:${CUSTOMER_ID}:pm_old`);
  });

  it('a customer without email or name creates a bare Stripe Customer (no null fields sent)', async () => {
    const world = makeWorld();
    world.repo.seedCustomer({ ...noCard, name: null, email: null });
    await createPaymentSetupLink(world.deps, CUSTOMER_ID);
    expect(world.stripe.callsTo('customers.create')[0]?.params).toEqual({ metadata: { operis_customer_id: CUSTOMER_ID } });
  });

  it('rejects an unknown customer with NotFoundError before any Stripe call', async () => {
    const world = makeWorld();
    await expect(createPaymentSetupLink(world.deps, CUSTOMER_ID)).rejects.toBeInstanceOf(NotFoundError);
    expect(world.stripe.calls).toHaveLength(0);
  });
});
