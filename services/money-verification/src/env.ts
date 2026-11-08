/**
 * Environment configuration. Values are passed in explicitly so modules never read process.env directly
 * (tests construct this object by hand). `envFromProcess()` is the one place that touches process.env.
 * Secret VALUES are never logged or persisted by this package.
 */
export interface Env {
  /** Base URL of the public web app, used for Checkout success/cancel and Connect onboarding return URLs. */
  PUBLIC_BASE_URL: string;
  /** Stripe webhook signing secret (whsec_...). */
  STRIPE_WEBHOOK_SECRET: string;
  /** Rolling 24h cap on new escrow holds, in cents. Default 200000 ($2,000). */
  DAILY_ESCROW_CAP_CENTS: number;
  /** Per-job payout cap, in cents, above which release_payout_large (human approval) is required. Default 15000. */
  PAYOUT_CAP_CENTS: number;
  /**
   * Identity gate for every job. 'enforce': a worker without a verified Stripe Identity cannot accept a job
   * (check_eligibility) and an agent can never approve their proof (a founder can, recording a waiver). 'log', the
   * default until the job page can get every worker verified (README, open items): the check is recorded but blocks
   * only notary and legal jobs. The "verified human" promise in llms.txt and SKILL.md holds only under 'enforce',
   * with Stripe Identity in live mode.
   */
  IDENTITY_GATE: IdentityGate;
  /** OpenAI-compatible chat completions endpoint for the vision scorer. */
  VERIFIER_BASE_URL?: string;
  VERIFIER_API_KEY?: string;
  VERIFIER_MODEL?: string;
}

export const DEFAULT_DAILY_ESCROW_CAP_CENTS = 200_000;
export const DEFAULT_PAYOUT_CAP_CENTS = 15_000;

export type IdentityGate = 'enforce' | 'log';
export const DEFAULT_IDENTITY_GATE: IdentityGate = 'log';

function identityGateOr(value: string | undefined, fallback: IdentityGate): IdentityGate {
  if (value === undefined || value.trim() === '') return fallback;
  const gate = value.trim().toLowerCase();
  if (gate !== 'enforce' && gate !== 'log') throw new Error(`invalid IDENTITY_GATE value: ${value} (enforce | log)`);
  return gate;
}

function intOr(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid integer env value: ${value}`);
  return n;
}

export function envFromProcess(source: NodeJS.ProcessEnv = process.env): Env {
  const PUBLIC_BASE_URL = source.PUBLIC_BASE_URL;
  if (!PUBLIC_BASE_URL) throw new Error('PUBLIC_BASE_URL is required');
  const STRIPE_WEBHOOK_SECRET = source.STRIPE_WEBHOOK_SECRET;
  if (!STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is required');
  return {
    PUBLIC_BASE_URL: PUBLIC_BASE_URL.replace(/\/+$/, ''),
    STRIPE_WEBHOOK_SECRET,
    // DAILY_HOLD_CAP_CENTS is the name used in the build spec; the checkpoint's name wins, the alias is accepted.
    DAILY_ESCROW_CAP_CENTS: intOr(source.DAILY_ESCROW_CAP_CENTS ?? source.DAILY_HOLD_CAP_CENTS, DEFAULT_DAILY_ESCROW_CAP_CENTS),
    PAYOUT_CAP_CENTS: intOr(source.PAYOUT_CAP_CENTS, DEFAULT_PAYOUT_CAP_CENTS),
    IDENTITY_GATE: identityGateOr(source.IDENTITY_GATE, DEFAULT_IDENTITY_GATE),
    VERIFIER_BASE_URL: source.VERIFIER_BASE_URL,
    VERIFIER_API_KEY: source.VERIFIER_API_KEY,
    VERIFIER_MODEL: source.VERIFIER_MODEL,
  };
}
