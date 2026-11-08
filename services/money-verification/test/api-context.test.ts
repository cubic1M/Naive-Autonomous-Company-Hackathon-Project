import { describe, expect, it } from 'vitest';
import { depsFromApiContext, sqlClientFromPostgresJs, type ApiContext } from '../src/api-context.js';
import { createContractTools } from '../src/contract-tools.js';
import type { VisionScorer } from '../src/proof/vision.js';
import { createTools } from '../src/tools.js';
import { handleStripeWebhook } from '../src/webhooks/stripe.js';
import { JOB_ID, PROOF_ID, WORKER_ID, makeJob, makeProof, makeWorker, makeWorld, seedVerifiedIdentity, webhookRequest } from './helpers.js';

const scorer: VisionScorer = {
  async score(input) {
    return { confidence: 0.95, mustShowFound: Object.fromEntries(input.mustShow.map((m) => [m, true])), notes: 'ok' };
  },
};

/** A fake contracts/runtime.ts ToolContext: records transitions and raw SQL, can refuse a transition. */
function fakeContext(opts: { refuse?: string[] } = {}) {
  const transitions: { jobId: string; to: string; patch?: Record<string, unknown> }[] = [];
  const sql: { text: string; params: unknown[] }[] = [];
  const logs: string[] = [];
  const ctx: ApiContext = {
    sql: {
      async unsafe(text, params = []) {
        sql.push({ text, params });
        return [];
      },
    },
    baseUrl: 'https://operis.test',
    async transition(jobId, to, patch) {
      if (opts.refuse?.includes(to)) throw new Error(`job ${jobId}: cannot move to ${to}`);
      transitions.push({ jobId, to, patch });
      return { id: jobId, status: to };
    },
    log: (...args) => {
      logs.push(args.map(String).join(' '));
    },
  };
  return { ctx, transitions, sql, logs };
}

describe('api-context: hooks become job-state transitions', () => {
  it('walks a job through held -> escalated -> approved -> paid with the API transition()', async () => {
    const world = makeWorld();
    const { ctx, transitions, sql } = fakeContext();
    const deps = depsFromApiContext(ctx, { repo: world.repo, stripe: world.stripe, env: world.env, vision: scorer, now: world.clock.now });
    const tools = createTools(deps);
    const contract = createContractTools(deps);

    world.repo.seedJob(makeJob({ proof_schema: { photos: { min: 1, must_show: ['sign'] }, geofence_m: 150 } }));
    const acct = await world.stripe.accounts.create({ type: 'express', metadata: { worker_id: WORKER_ID } });
    world.stripe.enablePayouts(acct.id);
    world.repo.seedWorker(makeWorker({ stripe_connect_account: acct.id }));
    await seedVerifiedIdentity(world);
    world.repo.seedProof(makeProof());

    await tools.create_escrow({ job_id: JOB_ID });
    const sessionId = (await world.repo.getEscrow(JOB_ID))?.stripe_checkout_session_id as string;
    await handleStripeWebhook(deps, webhookRequest(world, world.stripe.completeCheckout(sessionId)));
    expect(transitions[0]).toMatchObject({ jobId: JOB_ID, to: 'held', patch: { stripe_payment_intent: expect.stringMatching(/^pi_test_/) } });

    const ev = await contract.check_proof({ job_id: JOB_ID });
    expect(ev.decision).toBe('escalated'); // no EXIF time without readMedia
    expect(transitions[1]).toMatchObject({ jobId: JOB_ID, to: 'escalated' });
    const proofsMirror = sql.filter((q) => q.text.startsWith('update proofs'));
    expect(proofsMirror[0]?.params).toEqual(['escalated', 0.95, expect.stringContaining('time:'), 'auto', PROOF_ID]);

    expect(await contract.approve_proof({ job_id: JOB_ID, proof_id: PROOF_ID, notes: 'agent ok' })).toEqual({ job_id: JOB_ID, status: 'approved' });
    expect(transitions[2]).toMatchObject({ jobId: JOB_ID, to: 'approved' });
    expect(sql.filter((q) => q.text.startsWith('update proofs'))[1]?.params[3]).toBe('verifier-agent');

    await contract.capture_payment({ job_id: JOB_ID });
    expect(await contract.payout({ job_id: JOB_ID })).toMatchObject({ status: 'paid', worker_pay_usd: 45, fee_usd: 15 });
    expect(transitions[3]).toMatchObject({ jobId: JOB_ID, to: 'paid' });
    expect(sql.some((q) => q.text.startsWith('update workers set jobs_done'))).toBe(true);

    expect(await contract.refund({ job_id: JOB_ID, reason: 'test', request_id: 'req-t' })).toMatchObject({ job_id: JOB_ID, status: 'refunded', amount_usd: 60, refunded_total_usd: 60 });
    expect(transitions[4]).toMatchObject({ jobId: JOB_ID, to: 'refunded' });
  });

  it('refund on an uncaptured hold releases it and still ends the job refunded', async () => {
    const world = makeWorld();
    const { ctx, transitions } = fakeContext();
    const deps = depsFromApiContext(ctx, { repo: world.repo, stripe: world.stripe, env: world.env, vision: null });
    world.repo.seedJob(makeJob());
    world.repo.seedWorker(makeWorker());
    await createTools(deps).create_escrow({ job_id: JOB_ID });
    const sessionId = (await world.repo.getEscrow(JOB_ID))?.stripe_checkout_session_id as string;
    await handleStripeWebhook(deps, webhookRequest(world, world.stripe.completeCheckout(sessionId)));

    const out = await createContractTools(deps).refund({ job_id: JOB_ID, reason: 'proof rejected', request_id: 'req-t' });
    expect(out).toMatchObject({ job_id: JOB_ID, status: 'refunded', amount_usd: 60, refunded_total_usd: 60, released_hold: true });
    expect(world.stripe.callsTo('paymentIntents.cancel')).toHaveLength(1);
    expect(world.stripe.callsTo('refunds.create')).toHaveLength(0);
    expect(transitions.map((t) => t.to)).toEqual(['held', 'refunded']);
  });

  it('a refused transition is logged, not thrown, and the money write stands', async () => {
    const world = makeWorld();
    const { ctx, logs } = fakeContext({ refuse: ['held'] });
    const deps = depsFromApiContext(ctx, { repo: world.repo, stripe: world.stripe, env: world.env, vision: null });
    world.repo.seedJob(makeJob());
    await createTools(deps).create_escrow({ job_id: JOB_ID });
    const sessionId = (await world.repo.getEscrow(JOB_ID))?.stripe_checkout_session_id as string;
    const res = await handleStripeWebhook(deps, webhookRequest(world, world.stripe.completeCheckout(sessionId)));
    expect(res.status).toBe(200);
    expect((await world.repo.getEscrow(JOB_ID))?.status).toBe('authorized');
    expect(logs.some((l) => l.includes('transition') && l.includes('refused'))).toBe(true);
  });

  it('adapts a postgres.js client to the Repo SqlClient shape', async () => {
    const seen: { text: string; params: unknown[] }[] = [];
    const client = sqlClientFromPostgresJs({
      async unsafe(text, params = []) {
        seen.push({ text, params });
        return [{ id: 'x' }];
      },
    });
    const out = await client.query('select 1 where $1', ['a']);
    expect(out.rows).toEqual([{ id: 'x' }]);
    expect(seen).toEqual([{ text: 'select 1 where $1', params: ['a'] }]);
  });

  it('read-only tools work without a Stripe key (the client is built lazily)', async () => {
    const world = makeWorld();
    const { ctx } = fakeContext();
    const saved = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const deps = depsFromApiContext(ctx, { repo: world.repo, env: world.env, vision: null });
      expect(await createContractTools(deps).ledger({})).toEqual({ revenue_usd: 0, payouts_usd: 0, fees_usd: 0, costs_usd: 0, jobs_paid: 0 });
      expect(() => deps.stripe.accounts).toThrow(/STRIPE_SECRET_KEY/);
    } finally {
      if (saved !== undefined) process.env.STRIPE_SECRET_KEY = saved;
    }
  });
});
