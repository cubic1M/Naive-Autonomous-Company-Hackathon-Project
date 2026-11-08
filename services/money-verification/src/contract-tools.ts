/**
 * Adapters that expose this package under the exact names and shapes of contracts/tools.ts (Cameron's
 * rows in Edwin's registry: check_proof, approve_proof, escalate, capture_payment, payout, refund, ledger),
 * so each mock can be swapped for the real tool without reshaping anything. USD numbers at this
 * boundary, integer cents inside. Errors the contract models as `{ error }` are returned, not thrown.
 */
import { createHash } from 'node:crypto';
import { InvalidStateError, NotFoundError, RequiresApprovalError } from './errors.js';
import { reviewProof } from './proof/decide.js';
import { createTools, type ToolDeps } from './tools.js';
import type { ProofCheck, ProofDecision, ProofReview } from './types.js';

const usd = (cents: number): number => Math.round(cents) / 100;

/**
 * Why: the contract refund shape has no idempotency token, and escrow.refund's count-based key double-refunds when a
 * retry follows a webhook echo. Deriving the token from the request makes a blind retry a true Stripe replay; the cost
 * is that an identical second partial (same job, reason, amount) also replays, which errs toward under-refunding.
 * Callers wanting a deliberate repeat pass their own request_id.
 */
function derivedRequestId(jobId: string, reason: string, amountCents: number | undefined): string {
  return `auto-${createHash('sha256').update(`${jobId}|${reason}|${amountCents ?? 'full'}`).digest('hex').slice(0, 32)}`;
}

export interface CheckProofOut {
  proof_id: string;
  gps_distance_m: number | null;
  timestamp_ok: boolean;
  checklist: { item: string; found: boolean; confidence: number }[];
  /** 0..1; the vision confidence, 0 when no scorer ran. */
  overall_score: number;
  /** Every check that did not pass, as "name: detail". */
  flags: string[];
  // additive fields beyond contracts/tools.ts: the automated decision and the full check list
  decision: ProofDecision;
  checks: ProofCheck[];
}

export type ApproveProofOut = { job_id: string; status: 'approved' } | { error: 'below_threshold' | 'outside_geofence' | 'reused_media' };
export type PayoutOut =
  | { job_id: string; status: 'paid'; worker_pay_usd: number; fee_usd: number }
  | { error: 'needs_bank_setup'; onboarding_url: string }
  | { error: 'over_limit' };

export interface ContractTools {
  check_proof(input: { job_id: string }): Promise<CheckProofOut>;
  approve_proof(input: { job_id: string; proof_id: string; notes: string }): Promise<ApproveProofOut>;
  escalate(input: { job_id: string; proof_id: string; reason: string }): Promise<{ job_id: string; status: 'escalated' }>;
  capture_payment(input: { job_id: string }): Promise<{ job_id: string; captured_usd: number }>;
  payout(input: { job_id: string }): Promise<PayoutOut>;
  /** released_hold is set when nothing had been captured yet and the authorization was cancelled instead. */
  refund(input: { job_id: string; reason: string; amount_cents?: number; request_id?: string }): Promise<{
    job_id: string;
    status: 'refunded';
    amount_usd: number;
    /** Set when only part of the charge went back; the total so far is refunded_total_usd. */
    partial?: true;
    refunded_total_usd: number;
    released_hold?: true;
  }>;
  ledger(input: { since?: string }): Promise<{ revenue_usd: number; payouts_usd: number; fees_usd: number; costs_usd: number; jobs_paid: number }>;
}

function evidenceOf(review: ProofReview): CheckProofOut {
  const find = (name: string) => review.checks.find((c) => c.name === name);
  const geofence = find('geofence');
  const vision = find('vision');
  const distance = geofence?.data?.distance_m;
  const found = (vision?.data?.must_show_found ?? {}) as Record<string, boolean>;
  const confidence = review.confidence ?? 0;
  return {
    proof_id: review.proof_id,
    gps_distance_m: typeof distance === 'number' ? distance : null,
    timestamp_ok: find('time')?.status === 'pass',
    checklist: Object.entries(found).map(([item, ok]) => ({ item, found: ok === true, confidence })),
    overall_score: confidence,
    flags: review.checks.filter((c) => c.status !== 'pass').map((c) => `${c.name}: ${c.detail}`),
    decision: review.decision,
    checks: review.checks,
  };
}

export function createContractTools(deps: ToolDeps): ContractTools {
  const tools = createTools(deps);
  const decideDeps = {
    repo: deps.repo,
    hooks: deps.hooks,
    vision: deps.vision ?? null,
    readMedia: deps.readMedia,
    frameExtractor: deps.frameExtractor,
    now: deps.now,
  };

  return {
    /**
     * Run the automated review on the job's latest proof and return the evidence. A review a human
     * already made (reviewer !== 'auto') is returned as is, never re-run or overwritten.
     */
    async check_proof({ job_id }) {
      const proofs = await deps.repo.getProofsForJob(job_id);
      const proof = proofs[proofs.length - 1];
      if (!proof) throw new NotFoundError('proof for job', job_id);
      const existing = await deps.repo.getProofReview(proof.id);
      const review = existing && existing.reviewer !== 'auto' ? existing : await reviewProof(decideDeps, proof.id);
      return evidenceOf(review);
    },

    async approve_proof({ job_id, proof_id, notes }) {
      try {
        await tools.approve_proof({ job_id, proof_id, notes, reviewer: 'verifier-agent' });
        return { job_id, status: 'approved' };
      } catch (err) {
        if (err instanceof InvalidStateError) {
          if (err.message.startsWith('outside_geofence')) return { error: 'outside_geofence' };
          if (err.message.startsWith('below_threshold')) return { error: 'below_threshold' };
          if (err.message.startsWith('reused_media')) return { error: 'reused_media' };
        }
        throw err;
      }
    },

    async escalate({ job_id, proof_id, reason }) {
      await tools.escalate({ job_id, proof_id, reason });
      return { job_id, status: 'escalated' };
    },

    async capture_payment({ job_id }) {
      const out = await tools.capture_escrow({ job_id });
      return { job_id, captured_usd: usd(out.amount_cents) };
    },

    async payout({ job_id }) {
      let out;
      try {
        out = await tools.release_payout({ job_id });
      } catch (err) {
        if (err instanceof RequiresApprovalError) return { error: 'over_limit' };
        throw err;
      }
      if (out.status === 'pending_onboarding') return { error: 'needs_bank_setup', onboarding_url: out.onboarding_url };
      return { job_id, status: 'paid', worker_pay_usd: usd(out.worker_pay_cents), fee_usd: usd(out.fee_cents) };
    },

    /** Over-cap refunds throw RequiresApprovalError: the calling agent then asks the CEO agent for refund_large. */
    async refund({ job_id, reason, amount_cents, request_id }) {
      // A rejected or expired job was never captured: release the hold. contracts/states.ts still ends it `refunded`.
      const escrow = await deps.repo.getEscrow(job_id);
      if (escrow && (escrow.status === 'pending' || escrow.status === 'authorized')) {
        await tools.release_escrow({ job_id, reason });
        return { job_id, status: 'refunded', amount_usd: usd(escrow.amount_cents), refunded_total_usd: usd(escrow.amount_cents), released_hold: true };
      }
      const out = await tools.refund({ job_id, reason, amount_cents, request_id: request_id ?? derivedRequestId(job_id, reason, amount_cents) });
      const base = { job_id, status: 'refunded' as const, amount_usd: usd(out.amount_cents), refunded_total_usd: usd(out.refunded_total_cents) };
      return out.status === 'partially_refunded' ? { ...base, partial: true as const } : base;
    },

    /** revenue_usd = everything captured from customers (payouts + fees); fees_usd = our share before costs. */
    async ledger({ since }) {
      const p = await tools.ledger(since ? { from: since } : {});
      return {
        revenue_usd: usd(p.fees_cents + p.payouts_cents),
        payouts_usd: usd(p.payouts_cents),
        fees_usd: usd(p.fees_cents),
        costs_usd: usd(p.costs_cents),
        jobs_paid: p.jobs_paid,
      };
    },
  };
}
