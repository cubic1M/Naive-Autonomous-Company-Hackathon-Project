import { describe, expect, it } from 'vitest';
import { startIdentityVerification, verifiedIdentityName } from '../src/identity.js';
import { handleStripeEvent, handleStripeWebhook } from '../src/webhooks/stripe.js';
import { T0, WORKER_ID, makeWorker, makeWorld, seedVerifiedIdentity, webhookRequest, type World } from './helpers.js';

const verifiedHooks = (world: World) => world.fired.filter((f) => f.name === 'onWorkerVerified');

async function started() {
  const world = makeWorld();
  world.repo.seedWorker(makeWorker());
  const start = await startIdentityVerification(world.deps, WORKER_ID);
  return { world, sessionId: start.sessionId as string };
}

describe('startIdentityVerification', () => {
  it('creates a document session with a matching selfie and parks a pending row', async () => {
    const world = makeWorld();
    world.repo.seedWorker(makeWorker());
    const out = await startIdentityVerification(world.deps, WORKER_ID);
    expect(out).toEqual({
      workerId: WORKER_ID,
      status: 'pending',
      url: expect.stringMatching(/^https:\/\/verify\.stripe\.test\/vs_test_/),
      sessionId: expect.stringMatching(/^vs_test_/),
    });
    const call = world.stripe.callsTo('identity.verificationSessions.create')[0];
    expect(call?.idempotencyKey).toBe(`identity:${WORKER_ID}:1`);
    expect(call?.params).toEqual({
      type: 'document',
      options: { document: { require_matching_selfie: true } },
      metadata: { worker_id: WORKER_ID },
      client_reference_id: WORKER_ID,
      return_url: `https://operis.test/join/${WORKER_ID}/identity/done`,
    });
    const row = await world.repo.getWorkerVerification(WORKER_ID, 'identity');
    expect(row).toMatchObject({ kind: 'identity', status: 'pending', provider_ref: out.sessionId, verified_at: null, expires_at: null });
    expect(row?.details).toMatchObject({ attempts: 1, session_id: out.sessionId, started_at: T0.toISOString() });
    expect(world.fired).toHaveLength(0);
  });

  it('a second start while pending is a new attempt: new idempotency key, new session', async () => {
    const { world, sessionId } = await started();
    const again = await startIdentityVerification(world.deps, WORKER_ID);
    expect(again.sessionId).not.toBe(sessionId);
    expect(world.stripe.callsTo('identity.verificationSessions.create').map((c) => c.idempotencyKey)).toEqual([
      `identity:${WORKER_ID}:1`,
      `identity:${WORKER_ID}:2`,
    ]);
    expect((await world.repo.getWorkerVerification(WORKER_ID, 'identity'))?.details).toMatchObject({ attempts: 2, session_id: again.sessionId });
  });

  it('a retry after a failed row write replays the same Stripe session', async () => {
    const world = makeWorld();
    world.repo.seedWorker(makeWorker());
    const original = world.repo.upsertWorkerVerification.bind(world.repo);
    let failOnce = true;
    world.repo.upsertWorkerVerification = async (v) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('db down');
      }
      return original(v);
    };
    await expect(startIdentityVerification(world.deps, WORKER_ID)).rejects.toThrow('db down');
    const out = await startIdentityVerification(world.deps, WORKER_ID);
    expect(world.stripe.vsStore.size).toBe(1);
    expect(out.sessionId).toBe([...world.stripe.vsStore.keys()][0]);
    expect(world.stripe.callsTo('identity.verificationSessions.create').map((c) => c.idempotencyKey)).toEqual([
      `identity:${WORKER_ID}:1`,
      `identity:${WORKER_ID}:1`,
    ]);
  });

  it('an already verified worker gets no new session: url null, status verified', async () => {
    const world = makeWorld();
    world.repo.seedWorker(makeWorker());
    await seedVerifiedIdentity(world);
    expect(await startIdentityVerification(world.deps, WORKER_ID)).toEqual({ workerId: WORKER_ID, url: null, status: 'verified', sessionId: 'vs_test_seeded' });
    expect(world.stripe.callsTo('identity.verificationSessions.create')).toHaveLength(0);
  });

  it('throws not_found for an unknown worker', async () => {
    const world = makeWorld();
    await expect(startIdentityVerification(world.deps, WORKER_ID)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('identity webhooks', () => {
  it('verified: the row turns verified with the ID name and report, onWorkerVerified fires once, redelivery is a duplicate', async () => {
    const { world, sessionId } = await started();
    const event = world.stripe.identityVerifiedEvent(sessionId, { first_name: 'Pat', last_name: 'Example' });
    const res = await handleStripeWebhook(world.deps, webhookRequest(world, event));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ handled: true, duplicate: false, type: 'identity.verification_session.verified' });

    const row = await world.repo.getWorkerVerification(WORKER_ID, 'identity');
    expect(row).toMatchObject({ status: 'verified', provider_ref: sessionId, verified_at: T0, expires_at: null });
    expect(row?.details).toMatchObject({ attempts: 1, session_id: sessionId, type: 'document', first_name: 'Pat', last_name: 'Example', last_error: null });
    expect(row?.details.last_verification_report).toMatch(/^vr_test_/);
    expect(verifiedHooks(world)).toEqual([{ name: 'onWorkerVerified', args: [WORKER_ID, 'verified'] }]);
    expect(verifiedIdentityName(row)).toBe('Pat Example');
    // the payload carries no verified_outputs (observed against the sandbox); the names come from one expanded retrieve
    expect((event.data.object as { verified_outputs?: unknown }).verified_outputs).toBeUndefined();
    const retrieves = world.stripe.callsTo('identity.verificationSessions.retrieve');
    expect(retrieves).toHaveLength(1);
    expect(retrieves[0]?.params).toMatchObject({ id: sessionId, params: { expand: ['verified_outputs'] } });

    const again = await handleStripeWebhook(world.deps, webhookRequest(world, event));
    expect(await again.json()).toMatchObject({ duplicate: true, handled: false });
    expect(verifiedHooks(world)).toHaveLength(1);
  });

  it('a failed verified_outputs fetch keeps the verification (names null, error recorded) and still fires the hook', async () => {
    const { world, sessionId } = await started();
    world.stripe.identity.verificationSessions.retrieve = async () => {
      throw new Error('stripe unreachable');
    };
    const res = await handleStripeWebhook(world.deps, webhookRequest(world, world.stripe.identityVerifiedEvent(sessionId, { first_name: 'Pat', last_name: 'Example' })));
    expect(await res.json()).toMatchObject({ handled: true });
    const row = await world.repo.getWorkerVerification(WORKER_ID, 'identity');
    expect(row).toMatchObject({ status: 'verified', provider_ref: sessionId });
    expect(row?.details).toMatchObject({ first_name: null, last_name: null, verified_outputs_error: 'stripe unreachable' });
    expect(verifiedIdentityName(row)).toBeNull();
    expect(verifiedHooks(world)).toHaveLength(1);
  });

  it('the handler itself is idempotent: a second verified event (new id) changes nothing and fires no hook', async () => {
    const { world, sessionId } = await started();
    await handleStripeEvent(world.deps, world.stripe.identityVerifiedEvent(sessionId, { first_name: 'Pat', last_name: 'Example' }));
    const second = await handleStripeEvent(world.deps, world.stripe.identityVerifiedEvent(sessionId, { first_name: 'Pat', last_name: 'Example' }));
    expect(second).toMatchObject({ handled: false, detail: expect.stringMatching(/already verified/) });
    expect(verifiedHooks(world)).toHaveLength(1);
  });

  it('requires_input: needs_review with last_error, hook fires with needs_review', async () => {
    const { world, sessionId } = await started();
    const res = await handleStripeWebhook(world.deps, webhookRequest(world, world.stripe.identityRequiresInputEvent(sessionId)));
    expect(await res.json()).toMatchObject({ handled: true });
    const row = await world.repo.getWorkerVerification(WORKER_ID, 'identity');
    expect(row).toMatchObject({ status: 'needs_review', provider_ref: sessionId, verified_at: null });
    expect(row?.details).toMatchObject({ attempts: 1, last_error: { code: 'document_unverified_other', reason: 'The document could not be verified.' } });
    expect(verifiedHooks(world)).toEqual([{ name: 'onWorkerVerified', args: [WORKER_ID, 'needs_review'] }]);
    expect(verifiedIdentityName(row)).toBeNull();
  });

  it('requires_input without last_error (the session is simply still open) changes nothing', async () => {
    const { world, sessionId } = await started();
    const vs = world.stripe.vsStore.get(sessionId);
    const event = world.stripe.event('identity.verification_session.requires_input', { ...vs, last_error: null });
    const res = await handleStripeWebhook(world.deps, webhookRequest(world, event));
    expect(await res.json()).toMatchObject({ handled: false });
    expect((await world.repo.getWorkerVerification(WORKER_ID, 'identity'))?.status).toBe('pending');
    expect(verifiedHooks(world)).toHaveLength(0);
  });

  it('canceled: failed, hook fires with failed, and the worker can start again as attempt 2', async () => {
    const { world, sessionId } = await started();
    const res = await handleStripeWebhook(world.deps, webhookRequest(world, world.stripe.identityCanceledEvent(sessionId)));
    expect(await res.json()).toMatchObject({ handled: true });
    expect(await world.repo.getWorkerVerification(WORKER_ID, 'identity')).toMatchObject({ status: 'failed', provider_ref: sessionId });
    expect(verifiedHooks(world)).toEqual([{ name: 'onWorkerVerified', args: [WORKER_ID, 'failed'] }]);
    const restart = await startIdentityVerification(world.deps, WORKER_ID);
    expect(restart.status).toBe('pending');
    expect((await world.repo.getWorkerVerification(WORKER_ID, 'identity'))?.details).toMatchObject({ attempts: 2, last_error: null });
  });

  it('a stale requires_input or canceled after verification never downgrades the identity', async () => {
    const { world, sessionId } = await started();
    const older = await startIdentityVerification(world.deps, WORKER_ID); // attempt 2; the worker finishes attempt 1
    await handleStripeEvent(world.deps, world.stripe.identityVerifiedEvent(sessionId, { first_name: 'Pat', last_name: 'Example' }));
    const a = await handleStripeEvent(world.deps, world.stripe.identityRequiresInputEvent(older.sessionId as string));
    const b = await handleStripeEvent(world.deps, world.stripe.identityCanceledEvent(older.sessionId as string));
    expect(a.handled).toBe(false);
    expect(b.handled).toBe(false);
    expect(await world.repo.getWorkerVerification(WORKER_ID, 'identity')).toMatchObject({ status: 'verified', provider_ref: sessionId });
    expect(verifiedHooks(world)).toHaveLength(1);
  });

  it('a non-uuid worker_id or client_reference_id is not ours: unhandled, and the uuid column is never queried', async () => {
    const world = makeWorld();
    const queried: string[] = [];
    const original = world.repo.getWorkerVerification.bind(world.repo);
    world.repo.getWorkerVerification = async (workerId, kind) => {
      queried.push(workerId);
      // what Postgres answers for a non-uuid in a uuid column (22P02), which would make the webhook 500 and Stripe retry
      if (!/^[0-9a-f-]{36}$/i.test(workerId)) throw new Error(`invalid input syntax for type uuid: "${workerId}"`);
      return original(workerId, kind);
    };
    const sessions = [
      { metadata: { worker_id: 'not-a-uuid' }, client_reference_id: null },
      { metadata: {}, client_reference_id: 'user_42' },
      { metadata: { worker_id: `${WORKER_ID}x` }, client_reference_id: WORKER_ID },
    ];
    for (const type of ['identity.verification_session.verified', 'identity.verification_session.requires_input', 'identity.verification_session.canceled']) {
      for (const ids of sessions) {
        const event = world.stripe.event(type, { id: 'vs_foreign', object: 'identity.verification_session', status: 'processing', type: 'document', last_error: { code: 'document_expired', reason: 'expired' }, ...ids });
        const res = await handleStripeWebhook(world.deps, webhookRequest(world, event));
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ handled: false });
        expect(await handleStripeEvent(world.deps, event)).toMatchObject({ handled: false, detail: 'session vs_foreign has no worker_id' });
      }
    }
    expect(queried).toEqual([]);
    expect(world.repo.workerVerifications.size).toBe(0);
  });

  it('a session without worker_id metadata is reported unhandled', async () => {
    const world = makeWorld();
    const event = world.stripe.event('identity.verification_session.verified', {
      id: 'vs_foreign',
      object: 'identity.verification_session',
      status: 'verified',
      type: 'document',
      metadata: {},
      client_reference_id: null,
      verified_outputs: { first_name: 'X', last_name: 'Y' },
    });
    const res = await handleStripeWebhook(world.deps, webhookRequest(world, event));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ handled: false });
    expect(world.repo.workerVerifications.size).toBe(0);
  });
});
