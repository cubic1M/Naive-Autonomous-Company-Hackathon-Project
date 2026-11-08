import { describe, expect, it } from 'vitest';
import { fundAndCapture, makeJob, makeWorld, webhookRequest } from './helpers.js';

describe('test scaffolding: FakeStripe + helpers', () => {
  it('walks a job to a captured charge through the fake', async () => {
    const world = makeWorld();
    const job = world.repo.seedJob(makeJob());
    const { paymentIntentId, chargeId } = await fundAndCapture(world, job);
    expect(paymentIntentId).toMatch(/^pi_test_/);
    expect(chargeId).toMatch(/^ch_test_/);
    expect(world.stripe.piStore.get(paymentIntentId)?.status).toBe('succeeded');
    expect((await world.repo.getEscrow(job.id))?.status).toBe('captured');
  });

  it('honors idempotency keys: same key returns the same object, no new session', async () => {
    const world = makeWorld();
    const params = {
      mode: 'payment' as const,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: 6000, product_data: { name: 'x' } } }],
    };
    const a = await world.stripe.checkout.sessions.create(params, { idempotencyKey: 'k1' });
    const b = await world.stripe.checkout.sessions.create(params, { idempotencyKey: 'k1' });
    const c = await world.stripe.checkout.sessions.create(params, { idempotencyKey: 'k2' });
    expect(b).toBe(a);
    expect(c.id).not.toBe(a.id);
    expect(world.stripe.csStore.size).toBe(2);
    expect(world.stripe.callsTo('checkout.sessions.create')).toHaveLength(3);
  });

  it('rejects a reused idempotency key with different params, as Stripe does', async () => {
    const world = makeWorld();
    const mk = (unit_amount: number) => ({
      mode: 'payment' as const,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount, product_data: { name: 'x' } } }],
    });
    await world.stripe.checkout.sessions.create(mk(6000), { idempotencyKey: 'k1' });
    await expect(world.stripe.checkout.sessions.create(mk(7000), { idempotencyKey: 'k1' })).rejects.toThrow(/same parameters/);
    expect(world.stripe.csStore.size).toBe(1);
  });

  it('rejects (not throws synchronously) on invalid state', async () => {
    const world = makeWorld();
    await expect(world.stripe.paymentIntents.capture('pi_missing')).rejects.toThrow(/cannot be captured/);
  });

  it('signs webhook bodies the real SDK accepts, and the SDK rejects a corrupted signature', () => {
    const world = makeWorld();
    const event = world.stripe.event('ping', { id: 'x' });
    const good = webhookRequest(world, event);
    const bad = webhookRequest(world, event, { badSignature: true });
    const body = JSON.stringify(event);
    const secret = world.env.STRIPE_WEBHOOK_SECRET;
    const parsed = world.stripe.webhooks.constructEvent(body, good.headers.get('stripe-signature') ?? '', secret);
    expect(parsed.id).toBe(event.id);
    expect(() => world.stripe.webhooks.constructEvent(body, bad.headers.get('stripe-signature') ?? '', secret)).toThrow();
    expect(() => world.stripe.webhooks.constructEvent(body, good.headers.get('stripe-signature') ?? '', 'whsec_other')).toThrow();
  });
});

describe('FakeStripe: direct PaymentIntents, customers, setup-mode sessions', () => {
  const base = {
    amount: 6000,
    currency: 'usd',
    capture_method: 'manual' as const,
    confirm: true,
    off_session: true,
    transfer_group: 'job:x',
    metadata: { job_id: 'x' },
  };
  type CardError = { rawType?: string; code?: string; decline_code?: string; payment_intent?: { id: string; status: string } };

  it('confirms an off-session manual-capture PaymentIntent into requires_capture and honors its key', async () => {
    const world = makeWorld();
    const params = { ...base, payment_method: 'pm_card_visa', customer: 'cus_1' };
    const pi = await world.stripe.paymentIntents.create(params, { idempotencyKey: 'pi1' });
    expect(pi.status).toBe('requires_capture');
    expect(pi.amount_capturable).toBe(6000);
    expect(pi.capture_method).toBe('manual');
    expect(pi.payment_method).toBe('pm_card_visa');
    expect(pi.customer).toBe('cus_1');
    expect(pi.transfer_group).toBe('job:x');
    expect(pi.metadata).toEqual({ job_id: 'x' });
    expect(await world.stripe.paymentIntents.create(params, { idempotencyKey: 'pi1' })).toBe(pi);
    expect(world.stripe.piStore.size).toBe(1);
    expect((await world.stripe.paymentIntents.cancel(pi.id)).status).toBe('canceled');
  });

  it('declines pm_card_chargeDeclined as the SDK does (card_error / card_declined) and replays it under the same key', async () => {
    const world = makeWorld();
    const attempt = () => world.stripe.paymentIntents.create({ ...base, payment_method: 'pm_card_chargeDeclined' }, { idempotencyKey: 'pi2' });
    const err = (await attempt().catch((e: unknown) => e)) as CardError;
    expect(err).toBeInstanceOf(Error);
    expect(err.rawType).toBe('card_error');
    expect(err.code).toBe('card_declined');
    expect(err.decline_code).toBe('generic_decline');
    expect(err.payment_intent?.status).toBe('requires_payment_method');
    await expect(attempt()).rejects.toMatchObject({ code: 'card_declined' });
    expect(world.stripe.piStore.size).toBe(1);
  });

  it('pm_card_authenticationRequired fails off-session with authentication_required', async () => {
    const world = makeWorld();
    await expect(world.stripe.paymentIntents.create({ ...base, payment_method: 'pm_card_authenticationRequired' })).rejects.toMatchObject({
      rawType: 'card_error',
      code: 'authentication_required',
    });
  });

  it('rejects an idempotency key reused on a different endpoint, as Stripe does', async () => {
    const world = makeWorld();
    await world.stripe.customers.create({ metadata: { operis_customer_id: 'c1' } }, { idempotencyKey: 'shared' });
    await expect(world.stripe.paymentIntents.create({ ...base, payment_method: 'pm_card_visa' }, { idempotencyKey: 'shared' })).rejects.toMatchObject({
      rawType: 'idempotency_error',
    });
  });

  it('creates customers idempotently', async () => {
    const world = makeWorld();
    const params = { email: 'ops@acme.test', metadata: { operis_customer_id: 'c1' } };
    const a = await world.stripe.customers.create(params, { idempotencyKey: 'cust:c1' });
    expect(a.id).toMatch(/^cus_test_/);
    expect(a.email).toBe('ops@acme.test');
    expect(await world.stripe.customers.create(params, { idempotencyKey: 'cust:c1' })).toBe(a);
    expect(world.stripe.customerStore.size).toBe(1);
  });

  it('setup-mode sessions carry a SetupIntent; completing one saves the card the SetupIntent retrieve returns', async () => {
    const world = makeWorld();
    const cs = await world.stripe.checkout.sessions.create({
      mode: 'setup',
      customer: 'cus_1',
      payment_method_types: ['card'],
      metadata: { customer_id: 'c1' },
      success_url: 'https://x/ok',
      cancel_url: 'https://x/no',
    });
    expect(cs.mode).toBe('setup');
    expect(cs.payment_intent).toBeNull();
    expect(cs.setup_intent).toMatch(/^seti_test_/);
    expect(cs.customer).toBe('cus_1');
    const event = world.stripe.completeCheckout(cs.id, { paymentMethod: 'pm_test_saved' });
    expect(event.type).toBe('checkout.session.completed');
    const obj = event.data.object as { mode: string; setup_intent: string; status: string };
    expect(obj.mode).toBe('setup');
    expect(obj.status).toBe('complete');
    const seti = await world.stripe.setupIntents.retrieve(obj.setup_intent);
    expect(seti.status).toBe('succeeded');
    expect(seti.payment_method).toBe('pm_test_saved');
    expect(seti.customer).toBe('cus_1');
    await expect(world.stripe.setupIntents.retrieve('seti_missing')).rejects.toThrow(/No such setup intent/);
  });

  it('emits payment_intent.amount_capturable_updated for a capturable PaymentIntent', async () => {
    const world = makeWorld();
    const pi = await world.stripe.paymentIntents.create({ ...base, payment_method: 'pm_card_visa' });
    const event = world.stripe.amountCapturableUpdatedEvent(pi.id);
    expect(event.type).toBe('payment_intent.amount_capturable_updated');
    expect((event.data.object as { id: string; status: string }).id).toBe(pi.id);
    expect(() => world.stripe.amountCapturableUpdatedEvent('pi_missing')).toThrow(/No such payment intent/);
  });
});
