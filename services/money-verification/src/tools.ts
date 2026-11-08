/**
 * The internal MCP tools, as plain async functions over injected deps. Edwin registers them in the MCP
 * server (see README "Internal MCP tools"); Naive agents call them. Every function validates its input
 * with the zod schema in ./tools/schemas.ts and returns the matching output shape (snake_case, integer cents).
 * Business rules live in the modules this file calls; this layer only maps shapes and names.
 */
import { ZodError } from 'zod';
import type { Env } from './env.js';
import { checkEligibility } from './eligibility.js';
import { InvalidStateError, MoneyVerificationError, NotFoundError } from './errors.js';
import { captureEscrow, createEscrow, refund as refundEscrow, releaseEscrow, type EscrowDeps, type RefundResult } from './escrow.js';
import { getDisputeBundle, submitDisputeEvidence, type DisputeDeps } from './disputes.js';
import type { Hooks } from './hooks.js';
import { startIdentityVerification } from './identity.js';
import * as ledger from './ledger.js';
import { payWorker, type PayoutDeps, type PayWorkerResult } from './payouts.js';
import { approveProof, escalateProof, type DecideDeps } from './proof/decide.js';
import type { ReadMedia } from './proof/exif.js';
import type { FrameExtractor } from './proof/decide.js';
import type { VisionScorer } from './proof/vision.js';
import type { Repo } from './repo.js';
import { settleApprovedJob } from './settle.js';
import type { StripeClient } from './stripe-client.js';
import { verifyNotary } from './certs/notary.js';
import { resolveToolName, toolSchemas, type ToolInput, type ToolName, type ToolOutput } from './tools/schemas.js';
import type { ProofReview } from './types.js';

export { TOOL_ALIASES, TOOL_NAMES, resolveToolName, toolSchemas } from './tools/schemas.js';
export type { ToolInput, ToolName, ToolOutput } from './tools/schemas.js';

export interface ToolDeps {
  stripe: StripeClient;
  repo: Repo;
  env: Env;
  hooks?: Hooks;
  now?: () => Date;
  /** null/undefined -> every proof escalates (no vision scorer configured). */
  vision?: VisionScorer | null;
  readMedia?: ReadMedia;
  frameExtractor?: FrameExtractor;
}

export type Tools = { [N in ToolName]: (input: ToolInput<N>) => Promise<ToolOutput<N>> };

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

function payoutOut(jobId: string, feeCents: number, r: PayWorkerResult): ToolOutput<'release_payout'> {
  return r.status === 'paid'
    ? { status: 'paid', job_id: jobId, transfer_id: r.transferId, worker_pay_cents: r.amountCents, fee_cents: feeCents, transferred: r.transferred }
    : { status: 'pending_onboarding', job_id: jobId, onboarding_url: r.onboardingUrl, worker_pay_cents: r.amountCents };
}

/** Why: callers need to tell a partial refund (job stays paid) from the final one. */
function refundOut(jobId: string, r: RefundResult): ToolOutput<'refund'> {
  return {
    job_id: jobId,
    status: r.fullyRefunded ? 'refunded' : 'partially_refunded',
    amount_cents: r.refundCents,
    refunded_total_cents: r.refundedTotalCents,
  };
}

function reviewOut(r: ProofReview | null): ToolOutput<'get_proof_review'> {
  if (!r) return null;
  return {
    proof_id: r.proof_id,
    job_id: r.job_id,
    decision: r.decision,
    confidence: r.confidence,
    checks: r.checks.map((c) => ({ name: c.name, status: c.status, pass: c.pass, detail: c.detail, ...(c.data ? { data: c.data } : {}) })),
    reviewer: r.reviewer,
    created_at: r.created_at.toISOString(),
  };
}

async function requireJob(repo: Repo, jobId: string) {
  const job = await repo.getJob(jobId);
  if (!job) throw new NotFoundError('job', jobId);
  return job;
}

/**
 * The proof must belong to the job the caller named, checked BEFORE any decision is recorded;
 * otherwise an agent could approve the wrong job's proof.
 */
async function assertProofJob(repo: Repo, proofId: string, jobId: string): Promise<void> {
  const proof = await repo.getProof(proofId);
  if (!proof) throw new NotFoundError('proof', proofId);
  if (proof.job_id !== jobId) throw new InvalidStateError(`proof ${proofId} belongs to job ${proof.job_id}, not ${jobId}`);
}

export function createTools(deps: ToolDeps): Tools {
  const escrowDeps: EscrowDeps & PayoutDeps & DisputeDeps = deps;
  const decideDeps: DecideDeps = {
    repo: deps.repo,
    hooks: deps.hooks,
    vision: deps.vision ?? null,
    readMedia: deps.readMedia,
    frameExtractor: deps.frameExtractor,
    now: deps.now,
    env: deps.env,
  };
  const parse = <N extends ToolName>(name: N, input: unknown) => toolSchemas[name].input.parse(input) as ToolInput<N>;

  const tools: Tools = {
    async create_escrow(raw) {
      const { job_id } = parse('create_escrow', raw);
      const job = await requireJob(deps.repo, job_id);
      const { url, escrow, funded } = await createEscrow(escrowDeps, job);
      return { job_id, checkout_url: url, amount_cents: escrow.amount_cents, status: escrow.status, funded };
    },
    async capture_escrow(raw) {
      const { job_id } = parse('capture_escrow', raw);
      const { escrow, chargeId } = await captureEscrow(escrowDeps, job_id);
      return { job_id, status: 'captured', amount_cents: escrow.amount_cents, charge_id: chargeId };
    },
    async release_escrow(raw) {
      const { job_id, reason } = parse('release_escrow', raw);
      await releaseEscrow(escrowDeps, job_id, reason);
      return { job_id, status: 'released' };
    },
    async refund(raw) {
      const { job_id, reason, amount_cents, request_id } = parse('refund', raw);
      return refundOut(job_id, await refundEscrow(escrowDeps, job_id, reason, { amountCents: amount_cents, requestId: request_id }));
    },
    async refund_large(raw) {
      // approved_by is validated and carried in Naive's tool-call log; Stripe's Refund has no approver field.
      const { job_id, reason, amount_cents, request_id } = parse('refund_large', raw);
      return refundOut(job_id, await refundEscrow(escrowDeps, job_id, reason, { amountCents: amount_cents, allowLarge: true, requestId: request_id }));
    },
    async release_payout(raw) {
      const { job_id } = parse('release_payout', raw);
      const job = await requireJob(deps.repo, job_id);
      return payoutOut(job_id, job.fee_cents, await payWorker(escrowDeps, job_id));
    },
    async release_payout_large(raw) {
      // approved_by is validated and carried in Naive's tool-call log; the Transfer itself has no approver field.
      const { job_id } = parse('release_payout_large', raw);
      const job = await requireJob(deps.repo, job_id);
      return payoutOut(job_id, job.fee_cents, await payWorker(escrowDeps, job_id, { allowLarge: true }));
    },
    async settle_job(raw) {
      const { job_id } = parse('settle_job', raw);
      const job = await requireJob(deps.repo, job_id);
      const { chargeId, payout } = await settleApprovedJob(escrowDeps, job_id);
      return { job_id, charge_id: chargeId, payout: payoutOut(job_id, job.fee_cents, payout) };
    },
    async ledger(raw) {
      const { from, to } = parse('ledger', raw);
      const p = await ledger.pnl(deps.repo, { from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined });
      return {
        fees_cents: p.feesCents,
        payouts_cents: p.payoutsCents,
        refunds_cents: p.refundsCents,
        costs_cents: p.costsCents,
        gross_margin_cents: p.grossMarginCents,
        jobs_paid: p.jobsPaid,
      };
    },
    async get_proof_review(raw) {
      const { job_id, proof_id } = parse('get_proof_review', raw);
      const review = proof_id
        ? await deps.repo.getProofReview(proof_id)
        : await deps.repo.getLatestProofReviewForJob(job_id as string);
      return reviewOut(review);
    },
    async approve_proof(raw) {
      const { job_id, proof_id, notes, reviewer, override } = parse('approve_proof', raw);
      await assertProofJob(deps.repo, proof_id, job_id);
      await approveProof(decideDeps, { proofId: proof_id, reviewer: reviewer ?? 'verifier-agent', notes, override });
      return { job_id, proof_id, decision: 'approved' };
    },
    async escalate(raw) {
      const { job_id, proof_id, reason } = parse('escalate', raw);
      await assertProofJob(deps.repo, proof_id, job_id);
      await escalateProof(decideDeps, { proofId: proof_id, reviewer: 'verifier-agent', reason });
      return { job_id, proof_id, decision: 'escalated' };
    },
    async verify_notary(raw) {
      const { worker_id, commission_number, name, job_date } = parse('verify_notary', raw);
      const r = await verifyNotary(
        { repo: deps.repo, now: deps.now, stripe: deps.stripe },
        { workerId: worker_id, commissionNumber: commission_number, name, jobDate: new Date(job_date) },
      );
      return { worker_id, status: r.status, reasons: r.reasons, commission_expires: iso(r.record?.commission_expires), name_source: r.nameSource };
    },
    async verify_identity(raw) {
      const { worker_id } = parse('verify_identity', raw);
      const r = await startIdentityVerification(deps, worker_id);
      return { worker_id, url: r.url, status: r.status, session_id: r.sessionId };
    },
    async check_eligibility(raw) {
      const { worker_id, job_id } = parse('check_eligibility', raw);
      return checkEligibility({ repo: deps.repo, env: deps.env }, { workerId: worker_id, jobId: job_id });
    },
    async get_dispute(raw) {
      const { dispute_id } = parse('get_dispute', raw);
      const b = await getDisputeBundle({ repo: deps.repo }, dispute_id);
      if (!b) throw new NotFoundError('dispute', dispute_id);
      return {
        dispute: {
          id: b.dispute.id,
          job_id: b.dispute.job_id,
          status: b.dispute.status,
          reason: b.dispute.reason,
          amount_cents: b.dispute.amount_cents,
          evidence_due_by: iso(b.dispute.evidence_due_by),
          evidence: b.dispute.evidence,
        },
        job: b.job,
        proof_review: reviewOut(b.proofReview),
        ledger: b.ledger,
      };
    },
    async submit_dispute_evidence(raw) {
      const { dispute_id, evidence, submit } = parse('submit_dispute_evidence', raw);
      const d = await submitDisputeEvidence(escrowDeps, dispute_id, evidence, { submit });
      return { dispute_id, status: d.status, submitted: d.evidence_submitted_at !== null };
    },
  };
  return tools;
}

/** Call a tool by its name or an alias (hold_for_job, pay_worker, capture_payment, ...). */
export async function callTool(deps: ToolDeps, name: string, input: unknown): Promise<unknown> {
  const resolved = resolveToolName(name);
  if (!resolved) throw new NotFoundError('tool', name);
  const fn = createTools(deps)[resolved] as (input: unknown) => Promise<unknown>;
  return fn(input);
}

/** Shape any failure for the MCP response: stable `code`, human message, never a stack trace. */
export function describeToolError(err: unknown): { code: string; message: string } {
  if (err instanceof ZodError) return { code: 'invalid_input', message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  if (err instanceof MoneyVerificationError) return { code: err.code, message: err.message };
  // Why: Stripe refuses a reused idempotency key sent with different params; the agent must retry the ORIGINAL call
  // (same request_id, amount_cents) or use a new request_id for a new refund, not escalate to a human.
  if (err instanceof Error && (err as { rawType?: string }).rawType === 'idempotency_error') {
    return { code: 'idempotency_conflict', message: `${err.message} Retry with the same amount_cents as the original call, or use a new request_id for a different refund.` };
  }
  if (err instanceof Error) return { code: 'error', message: err.message };
  return { code: 'error', message: String(err) };
}
