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
