/**
 * Glue for Edwin's API (apps/api): build this package's deps from a contracts/runtime.ts ToolContext
 * (or from process.env), and turn our hooks into job-state transitions through ctx.transition(), with
 * mirrors into the shared proofs/workers rows that Dora's dashboard reads.
 *
 * This file imports nothing from apps/api or contracts/, so the package stays self-contained; the
 * services/payments and services/verify shims are where both sides meet.
 */
import { Pool } from '@neondatabase/serverless';
import Stripe from 'stripe';
import { envFromProcess, type Env } from './env.js';
import { MoneyVerificationError } from './errors.js';
import type { Hooks } from './hooks.js';
import { fetchMedia } from './proof/exif.js';
import { scorerFromEnv } from './proof/vision.js';
import type { Repo } from './repo.js';
import { PostgresRepo, type SqlClient } from './repo/postgres.js';
import { fromStripe, type StripeClient } from './stripe-client.js';
import { stripeModeFromEnv } from './stripe-mode.js';
import type { ToolDeps } from './tools.js';
import type { ProofReview } from './types.js';
import type { WebhookDeps } from './webhooks/stripe.js';

/** The slice of contracts/runtime.ts ToolContext this package uses. Typed loosely on purpose. */
export interface ApiContext {
  /** postgres.js tagged-template client; only `unsafe(text, params)` is used. */
  sql: { unsafe(query: string, params?: unknown[]): PromiseLike<unknown> };
  baseUrl: string;
  /** Move a job to a state (validated against contracts/states.ts) and wake the next agent. */
  transition(jobId: string, to: string, patch?: Record<string, unknown>): Promise<unknown>;
  log(...args: unknown[]): void;
}

export type ApiDeps = ToolDeps & WebhookDeps;

/** postgres.js client -> this package's { query(text, params) } shape. */
export function sqlClientFromPostgresJs(sql: ApiContext['sql']): SqlClient {
  return {
    async query<R extends Record<string, unknown>>(text: string, params: unknown[] = []) {
      const result = (await sql.unsafe(text, params)) as unknown;
      return { rows: (Array.isArray(result) ? result : []) as R[] };
    },
  };
}

export function stripeClientFromEnv(source: NodeJS.ProcessEnv = process.env): StripeClient {
  const key = source.STRIPE_SECRET_KEY;
  if (!key) throw new MoneyVerificationError('config', 'STRIPE_SECRET_KEY is not set');
  return fromStripe(new Stripe(key));
}

/** Constructs the Stripe client on first use, so read-only tools (ledger, check_proof) work without a key. */
function lazyStripe(make: () => StripeClient): StripeClient {
  let real: StripeClient | undefined;
  return new Proxy({} as StripeClient, {
    get: (_target, prop) => (real ??= make())[prop as keyof StripeClient],
  });
}

/** PUBLIC_BASE_URL may come from the API's baseUrl; a missing webhook secret fails closed (verifies nothing). */
function envFor(baseUrl: string | undefined, source: NodeJS.ProcessEnv = process.env): Env {
  return envFromProcess({
    ...source,
    PUBLIC_BASE_URL: source.PUBLIC_BASE_URL ?? baseUrl,
    STRIPE_WEBHOOK_SECRET: source.STRIPE_WEBHOOK_SECRET ?? 'whsec_unset',
  });
}

function reviewNotes(review: ProofReview | null): string {
  if (!review) return '';
  return review.checks
    .filter((c) => c.status !== 'pass' || c.name === 'reviewer_note')
    .map((c) => `${c.name}: ${c.detail}`)
    .join('; ')
    .slice(0, 1000);
}

/**
 * Hooks -> job-state transitions, plus mirrors into the shared proofs/workers rows. A refused transition
 * (the job is already there, or another path moved it first) is logged, never thrown: the money write
 * that preceded the hook must stand, and Stripe retries webhooks anyway.
 */
export function hooksFromApiContext(ctx: ApiContext, repo: Repo): Hooks {
  const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));
  const move = async (jobId: string, to: string, patch?: Record<string, unknown>) => {
    try {
      await ctx.transition(jobId, to, patch);
    } catch (err) {
      ctx.log(`[money-verification] transition ${jobId} -> ${to} refused: ${describe(err)}`);
    }
  };
  const mirror = async (label: string, query: string, params: unknown[]) => {
    try {
      await ctx.sql.unsafe(query, params);
    } catch (err) {
      ctx.log(`[money-verification] ${label} mirror failed: ${describe(err)}`);
    }
  };
  return {
    async onJobFunded(jobId) {
      const escrow = await repo.getEscrow(jobId);
      const pi = escrow?.stripe_payment_intent_id;
      await move(jobId, 'held', pi ? { stripe_payment_intent: pi } : undefined);
    },
    async onProofDecision(jobId, proofId, decision) {
      const review = await repo.getProofReview(proofId);
      await mirror(
        'proofs',
        'update proofs set status = $1, verifier_score = $2, verifier_notes = $3, reviewed_by = $4 where id = $5',
        [decision, review?.confidence ?? null, reviewNotes(review), review?.reviewer ?? 'auto', proofId],
      );
      await move(jobId, decision);
    },
    async onWorkerPaid(jobId, workerId) {
      await mirror('workers', 'update workers set jobs_done = coalesce(jobs_done, 0) + 1 where id = $1', [workerId]);
      await move(jobId, 'paid');
    },
    async onEscrowReleased(jobId) {
      // Both a refund and a released hold put the customer's money back; contracts/states.ts ends such jobs in `refunded`.
      await move(jobId, 'refunded');
    },
    async onWorkerPayoutReady(workerId) {
      ctx.log(`[money-verification] worker ${workerId} can now receive payouts`);
    },
    async onWorkerVerified(workerId, status) {
      // Informational for now: the job page re-reads worker_verifications (check_eligibility) on its next load.
      ctx.log(`[money-verification] worker ${workerId} identity verification is ${status}`);
    },
    async onDisputeOpened(disputeId, jobId) {
      ctx.log(`[money-verification] dispute ${disputeId} opened on job ${jobId ?? 'unknown'}: wake the Disputes agent`);
      // apps/api passes wakeDisputes (lib/naive.ts wake('disputes', ...)); without it this stays a log line.
      await (ctx as ApiContext & { wakeDisputes?: (d: string, j: string | null) => Promise<unknown> }).wakeDisputes?.(disputeId, jobId ?? null);
    },
  };
}

/** Deps for a tool call made by the API: its database client, its transition(), process.env for the rest. */
export function depsFromApiContext(ctx: ApiContext, overrides: Partial<ApiDeps> = {}): ApiDeps {
  // The repo hides Stripe ids of the other mode than STRIPE_SECRET_KEY's (test -> live cutover, see PostgresRepo).
  const stripeMode = overrides.stripeMode ?? stripeModeFromEnv();
  const repo = overrides.repo ?? new PostgresRepo(sqlClientFromPostgresJs(ctx.sql), { stripeMode });
  const env = overrides.env ?? envFor(ctx.baseUrl);
  return {
    stripe: overrides.stripe ?? lazyStripe(() => stripeClientFromEnv()),
    repo,
    env,
    hooks: overrides.hooks ?? hooksFromApiContext(ctx, repo),
    vision: overrides.vision !== undefined ? overrides.vision : scorerFromEnv(env),
    readMedia: overrides.readMedia ?? fetchMedia(),
    frameExtractor: overrides.frameExtractor,
    now: overrides.now,
    stripeMode,
  };
}

const globals = globalThis as { __operisMoneyPool?: Pool };

/**
 * Deps with no ToolContext (request_human's createHold runs before any agent is involved). Uses a
 * process-wide Neon pool, like apps/api's own db client. No hooks: nothing here changes job state.
 */
export function depsFromProcessEnv(source: NodeJS.ProcessEnv = process.env): ApiDeps {
  const url = source.DATABASE_URL;
  if (!url) throw new MoneyVerificationError('config', 'DATABASE_URL is not set');
  const pool = (globals.__operisMoneyPool ??= new Pool({ connectionString: url }));
  const env = envFor(undefined, source);
  return {
    stripe: lazyStripe(() => stripeClientFromEnv(source)),
    repo: new PostgresRepo(pool, { stripeMode: stripeModeFromEnv(source) }),
    env,
    vision: scorerFromEnv(env),
    readMedia: fetchMedia(),
  };
}
