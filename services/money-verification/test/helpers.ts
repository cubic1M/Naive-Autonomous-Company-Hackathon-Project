/**
 * Shared test scaffolding: fixed clock, in-memory repo, fake Stripe, hook recorder, row builders,
 * and a helper that walks a job to a captured escrow. Every test file builds on these so the
 * fixtures stay consistent across modules.
 */
import type { Env } from '../src/env.js';
import { captureEscrow, createEscrow, markAuthorized } from '../src/escrow.js';
import type { Hooks } from '../src/hooks.js';
import { quote } from '../src/pricing.js';
import { InMemoryRepo } from '../src/repo/memory.js';
import type { Job, Proof, ProofReview, Worker } from '../src/types.js';
import { FakeStripe } from './fakes/stripe.js';

export const TEST_ENV: Env = {
  PUBLIC_BASE_URL: 'https://operis.test',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
  DAILY_ESCROW_CAP_CENTS: 200_000,
  PAYOUT_CAP_CENTS: 15_000,
  VERIFIER_BASE_URL: 'https://verifier.test/v1',
  VERIFIER_API_KEY: 'verifier-test-key',
  VERIFIER_MODEL: 'test-vision',
};

/** Fixed "now" for deterministic tests: Sat 2026-11-07 10:00 PST. */
export const T0 = new Date('2026-11-07T18:00:00Z');
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;

/** YC office, San Francisco (the README example job location). */
export const YC = { lat: 37.7749, lng: -122.4194 };

export const JOB_ID = '00000000-0000-4000-8000-000000000001';
export const WORKER_ID = '00000000-0000-4000-8000-000000000002';
export const PROOF_ID = '00000000-0000-4000-8000-000000000003';
export const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';

export function makeJob(overrides: Partial<Job> = {}): Job {
  const q = quote(overrides.budget_cents ?? 6_000);
  return {
    id: JOB_ID,
    customer_id: CUSTOMER_ID,
    task_type: 'inspection',
    budget_cents: q.priceCents,
    worker_pay_cents: q.workerPayCents,
    fee_cents: q.feeCents,
    lat: YC.lat,
    lng: YC.lng,
    accepted_at: new Date(T0.getTime() - HOUR_MS),
    deadline: new Date(T0.getTime() + 4 * HOUR_MS),
    proof_schema: { photos: { min: 1, must_show: [] }, geofence_m: 150 },
    required_tier: 0,
    status: 'accepted',
    worker_id: WORKER_ID,
    risk_class: null,
    certification_required: null,
    ...overrides,
  };
}

export function makeWorker(overrides: Partial<Worker> = {}): Worker {
  return {
    id: WORKER_ID,
    name: 'Pat Example',
    phone: '+14155550100',
    stripe_connect_account: null,
    tier: 0,
    suspended: false,
    ...overrides,
  };
}

export function makeProof(overrides: Partial<Proof> = {}): Proof {
  return {
    id: PROOF_ID,
    job_id: JOB_ID,
    worker_id: WORKER_ID,
    media: [{ url: 'https://blob.test/proof-1.jpg', sha256: 'a'.repeat(64), mime: 'image/jpeg' }],
    fields: {},
    gps_lat: YC.lat,
    gps_lng: YC.lng,
    captured_at: new Date(T0.getTime() - 30 * MINUTE_MS),
    ...overrides,
  };
}

export function approvedReview(overrides: Partial<ProofReview> = {}): Omit<ProofReview, 'created_at'> {
  return {
    proof_id: PROOF_ID,
    job_id: JOB_ID,
    confidence: 0.95,
    decision: 'approved',
    checks: [],
    reviewer: 'test',
    ...overrides,
  };
}

export interface FiredHook {
  name: keyof Hooks;
  args: unknown[];
}

const HOOK_NAMES: (keyof Hooks)[] = [
  'onJobFunded',
  'onWorkerPayoutReady',
  'onWorkerVerified',
  'onProofDecision',
  'onEscrowReleased',
  'onWorkerPaid',
  'onDisputeOpened',
];

/** Hooks that record every call instead of waking agents. */
export function recordingHooks(): { hooks: Hooks; fired: FiredHook[] } {
  const fired: FiredHook[] = [];
  const hooks: Record<string, (...args: unknown[]) => Promise<void>> = {};
  for (const name of HOOK_NAMES) {
    hooks[name] = async (...args: unknown[]) => {
      fired.push({ name, args });
    };
  }
  return { hooks: hooks as Hooks, fired };
}

export interface Clock {
  now: () => Date;
  set(d: Date): void;
  advance(ms: number): void;
}

export function makeClock(start: Date = T0): Clock {
  let current = start;
  return {
    now: () => current,
    set(d) {
      current = d;
    },
    advance(ms) {
      current = new Date(current.getTime() + ms);
    },
  };
}

export interface World {
  repo: InMemoryRepo;
  stripe: FakeStripe;
  env: Env;
  hooks: Hooks;
  fired: FiredHook[];
  clock: Clock;
  /** Satisfies EscrowDeps, PayoutDeps and the other *Deps shapes. */
  deps: { stripe: FakeStripe; repo: InMemoryRepo; env: Env; hooks: Hooks; now: () => Date };
}

export function makeWorld(opts: { now?: Date; env?: Partial<Env> } = {}): World {
  const clock = makeClock(opts.now ?? T0);
  const repo = new InMemoryRepo(clock.now);
  const stripe = new FakeStripe(clock.now);
  const { hooks, fired } = recordingHooks();
  const env: Env = { ...TEST_ENV, ...opts.env };
  return { repo, stripe, env, hooks, fired, clock, deps: { stripe, repo, env, hooks, now: clock.now } };
}

/**
 * Walk a seeded job through the money path up to a CAPTURED escrow (no payout):
 * createEscrow -> customer pays on Checkout -> markAuthorized -> captureEscrow.
 */
export async function fundAndCapture(world: World, job: Job): Promise<{ paymentIntentId: string; chargeId: string }> {
  const { escrow } = await createEscrow(world.deps, job);
  const sessionId = escrow.stripe_checkout_session_id;
  if (!sessionId) throw new Error('escrow has no checkout session');
  world.stripe.completeCheckout(sessionId);
  const paymentIntentId = world.stripe.csStore.get(sessionId)?.payment_intent;
  if (!paymentIntentId) throw new Error('checkout session has no payment intent');
  await markAuthorized(world.deps, job.id, paymentIntentId);
  const { chargeId } = await captureEscrow(world.deps, job.id);
  if (!chargeId) throw new Error('capture produced no charge id');
  return { paymentIntentId, chargeId };
}

/** Build the Web Request a Stripe webhook delivery looks like; `badSignature` corrupts the header. */
export function webhookRequest(
  world: World,
  event: unknown,
  opts: { badSignature?: boolean; secret?: string } = {},
): Request {
  const body = JSON.stringify(event);
  const secret = opts.secret ?? world.env.STRIPE_WEBHOOK_SECRET;
  let header = world.stripe.signHeader(body, secret);
  if (opts.badSignature) header = header.replace(/v1=.{8}/, 'v1=deadbeef');
  return new Request('https://operis.test/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': header },
    body,
  });
}

/** A verified Stripe Identity row for the worker, as the identity.verification_session.verified webhook leaves it. */
export async function seedVerifiedIdentity(
  world: World,
  opts: { workerId?: string; firstName?: string; lastName?: string } = {},
): Promise<void> {
  await world.repo.upsertWorkerVerification({
    worker_id: opts.workerId ?? WORKER_ID,
    kind: 'identity',
    status: 'verified',
    provider_ref: 'vs_test_seeded',
    details: { attempts: 1, session_id: 'vs_test_seeded', type: 'document', first_name: opts.firstName ?? 'Pat', last_name: opts.lastName ?? 'Example' },
    verified_at: world.clock.now(),
    expires_at: null,
  });
}
