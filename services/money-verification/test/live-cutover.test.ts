/**
 * Test -> live cutover: ids saved under the sandbox key do not exist for a live key. The repo treats them as absent,
 * so each flow re-creates its Stripe object in live mode instead of failing with resource_missing.
 * `repo.stripeMode = 'live'` stands for the key swap; a fresh FakeStripe stands for the live account, which has
 * none of the sandbox's objects.
 */
import { describe, expect, it } from 'vitest';
import { createPaymentSetupLink } from '../src/customer-payment.js';
import { createEscrow } from '../src/escrow.js';
import { startIdentityVerification } from '../src/identity.js';
import { createOnboardingLink, payWorker } from '../src/payouts.js';
import { FakeStripe } from './fakes/stripe.js';
import { CUSTOMER_ID, JOB_ID, WORKER_ID, approvedReview, makeJob, makeWorker, makeWorld, seedVerifiedIdentity, type World } from './helpers.js';

const customer = { customer_id: CUSTOMER_ID, name: 'Acme Agent', email: 'ops@acme.test', stripe_customer_id: null, default_payment_method_id: null };

/** Swap to the live key: same database, a Stripe account with none of the test objects. */
function goLive(world: World) {
  world.repo.stripeMode = 'live';
  const stripe = new FakeStripe(world.clock.now);
  return { stripe, deps: { ...world.deps, stripe } };
}

describe('live cutover: customers and saved cards', () => {
  it('hides a test-mode Stripe Customer and card from a live key', async () => {
    const world = makeWorld();
    world.repo.seedCustomer(customer);
    await world.repo.setCustomerPayment(CUSTOMER_ID, { stripe_customer_id: 'cus_test', default_payment_method_id: 'pm_test' });
    world.repo.stripeMode = 'live';
    expect(await world.repo.getCustomerPayment(CUSTOMER_ID)).toMatchObject({ stripe_customer_id: null, default_payment_method_id: null });
    world.repo.stripeMode = 'test';
    expect(await world.repo.getCustomerPayment(CUSTOMER_ID)).toMatchObject({ stripe_customer_id: 'cus_test', default_payment_method_id: 'pm_test' });
  });

  it('rows seeded before migration 0005 (no mode stored) count as test', async () => {
    const world = makeWorld();
    world.repo.seedCustomer({ ...customer, stripe_customer_id: 'cus_old', default_payment_method_id: 'pm_old' });
    world.repo.stripeMode = 'live';
    expect(await world.repo.getCustomerPayment(CUSTOMER_ID)).toMatchObject({ stripe_customer_id: null, default_payment_method_id: null });
  });

  it('setup_payment under a live key creates a live Customer, and the test card never comes back with it', async () => {
    const world = makeWorld();
    world.repo.seedCustomer({ ...customer, stripe_customer_id: 'cus_test', default_payment_method_id: 'pm_test' });
    const live = goLive(world);

    const r = await createPaymentSetupLink(live.deps, CUSTOMER_ID);
    const [created] = live.stripe.callsTo('customers.create');
    expect(created).toBeDefined();
    expect(r.stripeCustomerId).not.toBe('cus_test');
    expect(live.stripe.callsTo('checkout.sessions.create')[0]?.params).toMatchObject({ customer: r.stripeCustomerId });
    // Writing the live customer id must not resurrect the test card as if it were live.
    expect(await world.repo.getCustomerPayment(CUSTOMER_ID)).toMatchObject({ stripe_customer_id: r.stripeCustomerId, default_payment_method_id: null });
  });

  it('a job whose requester saved a card in test mode gets a Checkout link in live, not a hold on the test card', async () => {
    const world = makeWorld();
    world.repo.seedCustomer({ ...customer, stripe_customer_id: 'cus_test', default_payment_method_id: 'pm_test' });
    const job = world.repo.seedJob(makeJob());
    world.repo.linkJobToCustomer(JOB_ID, CUSTOMER_ID);
    const live = goLive(world);

    const r = await createEscrow(live.deps, job);
    expect(live.stripe.callsTo('paymentIntents.create')).toHaveLength(0);
    expect(r).toMatchObject({ funded: false });
    expect(r.url).toMatch(/^https:/);
    expect(r.fallback_reason).toBeUndefined();
  });
});

describe('live cutover: worker Connect accounts', () => {
  it('a test-mode Express account is absent under a live key: live onboarding creates a new account', async () => {
    const world = makeWorld();
    world.repo.seedWorker(makeWorker());
    await world.repo.setWorkerConnectAccount(WORKER_ID, 'acct_test');
    const live = goLive(world);

    expect((await world.repo.getWorker(WORKER_ID))?.stripe_connect_account).toBeNull();
    expect(await world.repo.getWorkerByConnectAccount('acct_test')).toBeNull();
    const link = await createOnboardingLink(live.deps, (await world.repo.getWorker(WORKER_ID))!);
    expect(live.stripe.callsTo('accounts.create')).toHaveLength(1);
    expect(link.accountId).not.toBe('acct_test');
    expect((await world.repo.getWorker(WORKER_ID))?.stripe_connect_account).toBe(link.accountId);
    expect((await world.repo.getWorkerByConnectAccount(link.accountId))?.id).toBe(WORKER_ID);
  });

  it('a payout to a worker onboarded only in test mode parks for live onboarding instead of transferring', async () => {
    const world = makeWorld();
    world.repo.seedWorker(makeWorker({ stripe_connect_account: 'acct_test' }));
    world.repo.seedJob(makeJob({ worker_id: WORKER_ID }));
    await world.repo.upsertProofReview(approvedReview());
    await world.repo.insertEscrow({
      job_id: JOB_ID, stripe_checkout_session_id: null, stripe_payment_intent_id: 'pi_live', amount_cents: 2000,
      status: 'captured', authorization_expires_at: null,
    });
    const live = goLive(world);

    const r = await payWorker(live.deps, JOB_ID);
    expect(r.status).toBe('pending_onboarding');
    expect(live.stripe.callsTo('transfers.create')).toHaveLength(0);
    expect(live.stripe.callsTo('accounts.retrieve')).toHaveLength(0);
  });
});

describe('live cutover: Stripe Identity', () => {
  it('a test-mode verified identity does not count under a live key; the worker is sent through live Identity', async () => {
    const world = makeWorld();
    world.repo.seedWorker(makeWorker());
    await seedVerifiedIdentity(world);
    const live = goLive(world);

    expect(await world.repo.getWorkerVerification(WORKER_ID, 'identity')).toBeNull();
    const start = await startIdentityVerification(live.deps, WORKER_ID);
    expect(start.status).toBe('pending');
    expect(live.stripe.callsTo('identity.verificationSessions.create')).toHaveLength(1);
    expect(await world.repo.getWorkerVerification(WORKER_ID, 'identity')).toMatchObject({ status: 'pending', provider_ref: start.sessionId });
  });

  it('non-Stripe checks (notary commission) are not mode-scoped', async () => {
    const world = makeWorld();
    await world.repo.upsertWorkerVerification({
      worker_id: WORKER_ID, kind: 'notary_commission', status: 'verified', provider_ref: '1234567', details: {},
      verified_at: world.clock.now(), expires_at: null,
    });
    world.repo.stripeMode = 'live';
    expect(await world.repo.getWorkerVerification(WORKER_ID, 'notary_commission')).toMatchObject({ status: 'verified' });
  });
});
