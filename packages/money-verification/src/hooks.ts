import type { ProofDecision, VerificationStatus } from './types.js';

/**
 * Hooks are how this package wakes the rest of the company (Naive agents, SMS, job state machine).
 * Teammates inject implementations; this package never calls Naive, Twilio or the jobs table directly.
 * Every hook is optional and awaited; a throwing hook does NOT roll back the money/DB write that preceded it.
 */
export interface Hooks {
  /** Checkout completed: card authorized (not captured). Job should move quoted -> funded. */
  onJobFunded?: (jobId: string) => Promise<void> | void;
  /** Connect account has payouts_enabled = true; the worker can now be offered jobs. */
  onWorkerPayoutReady?: (workerId: string) => Promise<void> | void;
  /** Stripe Identity session finished (verified) or needs more input. */
  onWorkerVerified?: (workerId: string, status: VerificationStatus) => Promise<void> | void;
  /** Automated proof review wrote a proof_reviews row. */
  onProofDecision?: (jobId: string, proofId: string, decision: ProofDecision) => Promise<void> | void;
  /** Escrow released (PaymentIntent canceled) or refunded. */
  onEscrowReleased?: (jobId: string, kind: 'released' | 'refunded') => Promise<void> | void;
}

export async function fire<K extends keyof Hooks>(
  hooks: Hooks | undefined,
  name: K,
  ...args: Parameters<NonNullable<Hooks[K]>>
): Promise<void> {
  const fn = hooks?.[name] as ((...a: unknown[]) => Promise<void> | void) | undefined;
  if (fn) await fn(...args);
}
