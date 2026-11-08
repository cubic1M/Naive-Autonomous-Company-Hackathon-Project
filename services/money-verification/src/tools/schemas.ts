/**
 * Zod schemas for the internal MCP tools this package backs (Edwin registers them in the MCP server).
 * Operis is "humans on demand for autonomous companies": these tools move the money (escrow holds,
 * capture, payouts, refunds, ledger), review proof, verify certifications and handle chargebacks.
 * All money is integer cents; ids are UUIDs except Stripe ids (plain strings); timestamps are ISO-8601 with offset.
 *
 * Drafted by the local model from a written spec; reviewed by the coordinator.
 */
import { z } from 'zod';

const uuid = z.string().uuid();
const cents = z.number().int().nonnegative();
const isoDateTime = z.string().datetime({ offset: true });
const escrowStatus = z.enum(['pending', 'authorized', 'captured', 'released', 'refunded']);
const proofDecision = z.enum(['approved', 'escalated', 'rejected']);
const checkStatus = z.enum(['pass', 'fail', 'needs_review']);
const proofCheck = z.object({ name: z.string(), status: checkStatus, pass: z.boolean(), detail: z.string(), data: z.record(z.unknown()).optional() });
const payoutResult = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('paid'),
    job_id: uuid,
    transfer_id: z.string(),
    worker_pay_cents: cents,
    fee_cents: cents,
    transferred: z.boolean(),
  }),
  z.object({ status: z.literal('pending_onboarding'), job_id: uuid, onboarding_url: z.string().url(), worker_pay_cents: cents }),
]);
/** Optional replay key: a retried call with the same id returns the first refund instead of creating another. */
/** Required: the idempotency token. A retry reuses it (true replay); a second intended refund uses a new one. */
const requestId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const refundResult = z.object({
  job_id: uuid,
  status: z.enum(['refunded', 'partially_refunded']),
  amount_cents: cents,
  refunded_total_cents: cents,
});
const disputeEvidence = z
  .object({
    product_description: z.string().optional(),
    customer_communication: z.string().optional(),
    service_date: z.string().optional(),
    service_documentation: z.string().optional(),
    uncategorized_text: z.string().optional(),
    access_activity_log: z.string().optional(),
    shipping_documentation: z.string().optional(),
    billing_address: z.string().optional(),
    customer_name: z.string().optional(),
    customer_email_address: z.string().optional(),
  })
  .strict();

export const toolSchemas = {
  create_escrow: {
    description:
      "Hold the customer's card for a job (manual capture). With a card on file the hold is placed at once (checkout_url null, funded true); otherwise returns the Stripe Checkout URL the customer agent must pay at.",
    input: z.object({ job_id: uuid }).strict(),
    output: z.object({ job_id: uuid, checkout_url: z.string().url().nullable(), amount_cents: cents, status: escrowStatus, funded: z.boolean() }),
  },
  capture_escrow: {
    description: 'Charge the held card after proof approval.',
    input: z.object({ job_id: uuid }).strict(),
    output: z.object({ job_id: uuid, status: z.literal('captured'), amount_cents: cents, charge_id: z.string().nullable() }),
  },
  release_escrow: {
    description: 'Release an uncaptured hold for a failed/expired/cancelled job.',
    input: z.object({ job_id: uuid, reason: z.string().optional() }).strict(),
    output: z.object({ job_id: uuid, status: z.literal('released') }),
  },
  refund: {
    description: 'Refund a captured charge, in full or partially (amount_cents). Once a job\'s refunds would pass the cap (PAYOUT_CAP_CENTS, $150 by default) it fails with requires_approval: ask the CEO agent for refund_large. request_id is required: reuse the SAME id when retrying a failed call, a new id for a second intended refund.',
    input: z.object({ job_id: uuid, reason: z.string().min(3), amount_cents: cents.positive().optional(), request_id: requestId }).strict(),
    output: refundResult,
  },
  refund_large: {
    description: 'Refund past the cap after the CEO agent\'s approval. approved_by is logged, not verified or stored; the control is which agent Naive lets call this tool.',
    input: z
      .object({
        job_id: uuid,
        reason: z.string().min(3),
        amount_cents: cents.positive().optional(),
        request_id: requestId,
        approved_by: z.string().min(1),
        approval_note: z.string().optional(),
      })
      .strict(),
    output: refundResult,
  },
  release_payout: {
    description: 'Pay the worker their 75% (<= $150). First payout returns an onboarding URL instead.',
    input: z.object({ job_id: uuid }).strict(),
    output: payoutResult,
  },
  release_payout_large: {
    description: 'Pay a worker past the cap after the CEO agent\'s approval. approved_by is logged, not verified or stored.',
    input: z.object({ job_id: uuid, approved_by: z.string().min(1), approval_note: z.string().optional() }).strict(),
    output: payoutResult,
  },
  settle_job: {
    description: 'Idempotent capture + payout for an approved job.',
    input: z.object({ job_id: uuid }).strict(),
    output: z.object({ job_id: uuid, charge_id: z.string().nullable(), payout: payoutResult }),
  },
  ledger: {
    description: 'P&L over a period.',
    input: z.object({ from: isoDateTime.optional(), to: isoDateTime.optional() }).strict(),
    output: z.object({
      fees_cents: cents,
      payouts_cents: cents,
      refunds_cents: cents,
      costs_cents: cents,
      gross_margin_cents: z.number().int(),
      jobs_paid: z.number().int().nonnegative(),
    }),
  },
  get_proof_review: {
    description: "Latest automated/manual review for a job's proof.",
    input: z
      .object({ job_id: uuid.optional(), proof_id: uuid.optional() })
      .strict()
      .refine((v) => Boolean(v.job_id || v.proof_id), { message: 'job_id or proof_id required' }),
    output: z
      .object({
        proof_id: uuid,
        job_id: uuid,
        decision: proofDecision,
        confidence: z.number().min(0).max(1).nullable(),
        checks: z.array(proofCheck),
        reviewer: z.string(),
        created_at: isoDateTime,
      })
      .nullable(),
  },
  approve_proof: {
    description: 'Approve a proof. Geofence and media-reuse failures can never be approved; override lifts only the confidence threshold.',
    input: z
      .object({ job_id: uuid, proof_id: uuid, notes: z.string(), reviewer: z.string().optional(), override: z.boolean().default(false) })
      .strict(),
    output: z.object({ job_id: uuid, proof_id: uuid, decision: z.literal('approved') }),
  },
  escalate: {
    description: 'Send a proof to human review.',
    input: z.object({ job_id: uuid, proof_id: uuid, reason: z.string().min(3) }).strict(),
    output: z.object({ job_id: uuid, proof_id: uuid, decision: z.literal('escalated') }),
  },
  verify_notary: {
    description:
      "Check a notary commission against the California Secretary of State listing. The name compared is the worker's verified Stripe Identity name when one is on file, else the typed name (name_source says which).",
    input: z.object({ worker_id: uuid, commission_number: z.string().min(1), name: z.string().min(1), job_date: isoDateTime }).strict(),
    output: z.object({
      worker_id: uuid,
      status: z.enum(['verified', 'needs_review', 'failed']),
      reasons: z.array(z.string()),
      commission_expires: isoDateTime.nullable(),
      name_source: z.enum(['verified_identity', 'typed']),
    }),
  },
  verify_attorney: {
    description: 'Check a worker\'s California State Bar licence (connector legal jobs, policy L2): active status and a matching name.',
    input: z.object({ worker_id: uuid, bar_number: z.string().min(1).max(10), name: z.string().min(2).max(200) }).strict(),
    output: z.object({
      status: z.enum(['verified', 'needs_review', 'failed']), reasons: z.array(z.string()),
      name_on_record: z.string().nullable(), licence_status: z.string().nullable(),
      name_source: z.enum(['verified_identity', 'typed']),
    }),
  },
  verify_identity: {
    description:
      "Start the worker's Stripe Identity verification (government ID plus a matching selfie): returns the hosted url to send the worker to, or status 'verified' with url null when the identity is already on file. Tier-2 jobs (over $150, or any certification) need it before a proof can be approved.",
    input: z.object({ worker_id: uuid }).strict(),
    output: z.object({
      worker_id: uuid,
      url: z.string().url().nullable(),
      status: z.enum(['pending', 'verified', 'failed', 'needs_review']),
      session_id: z.string().nullable(),
    }),
  },
  check_eligibility: {
    description: "Can this worker take this job (not suspended, tier, required certification verified, a verified identity, which every job needs)? Also returns the job's verification tier.",
    input: z.object({ worker_id: uuid, job_id: uuid }).strict(),
    output: z.object({ eligible: z.boolean(), reasons: z.array(z.string()), tier: z.number().int().min(0).max(2) }),
  },
  get_liability_context: {
    description: 'Compliance: the job\'s intake tags, pricing, allowed models, any recorded decision, and the full liability policy text. Read the job itself with get_job.',
    input: z.object({ job_id: uuid }).strict(),
    output: z.object({
      job_id: z.string(), pricing: z.enum(['standard', 'connector']),
      tags: z.object({ rules: z.array(z.string()), forced: z.enum(['connector', 'refuse']).nullable(), hints: z.array(z.string()) }),
      decision: z.object({ model: z.string(), rule_id: z.string().nullable(), reason: z.string().nullable(), decided_by: z.string().nullable(), decided_at: z.string().nullable() }).nullable(),
      allowed_models: z.array(z.enum(['operis', 'connector', 'refuse'])), policy_version: z.string(), policy: z.string(),
    }),
  },
  set_liability: {
    description: 'Compliance: record the job\'s liability model (operis, connector or refuse) with the policy rule id and a one-line reason. Final once recorded.',
    input: z.object({ job_id: uuid, model: z.enum(['operis', 'connector', 'refuse']), rule_id: z.string().min(1).max(4), reason: z.string().trim().min(1).max(500) }).strict(),
    output: z.object({ job_id: z.string(), model: z.enum(['operis', 'connector', 'refuse']), rule_id: z.string(), reason: z.string(), next: z.enum(['wake_ceo', 'cancel']), changed: z.boolean() }),
  },
  get_dispute: {
    description: 'Evidence bundle for a chargeback: job, proof review, ledger lines.',
    input: z.object({ dispute_id: z.string().min(1) }).strict(),
    output: z.object({
      dispute: z.object({
        id: z.string(),
        job_id: uuid.nullable(),
        status: z.string(),
        reason: z.string().nullable(),
        amount_cents: cents,
        evidence_due_by: isoDateTime.nullable(),
        evidence: z.record(z.unknown()),
      }),
      job: z.unknown().nullable(),
      proof_review: z.unknown().nullable(),
      ledger: z.array(z.unknown()),
    }),
  },
  submit_dispute_evidence: {
    description: 'Draft (default) or submit chargeback evidence to Stripe.',
    input: z.object({ dispute_id: z.string().min(1), evidence: disputeEvidence, submit: z.boolean().default(false) }).strict(),
    output: z.object({ dispute_id: z.string(), status: z.string(), submitted: z.boolean() }),
  },
} as const;

export type ToolName = keyof typeof toolSchemas;
export type ToolInput<N extends ToolName> = z.input<(typeof toolSchemas)[N]['input']>;
export type ToolOutput<N extends ToolName> = z.output<(typeof toolSchemas)[N]['output']>;
export const TOOL_NAMES = Object.keys(toolSchemas) as ToolName[];

/** Other names used in the build spec and in Edwin's contracts/tools.ts for the same tools. */
export const TOOL_ALIASES: Record<string, ToolName> = {
  hold_for_job: 'create_escrow',
  charge_job: 'capture_escrow',
  capture_payment: 'capture_escrow',
  release_hold: 'release_escrow',
  pay_worker: 'release_payout',
  payout: 'release_payout',
  pay_worker_large: 'release_payout_large',
  escalate_proof: 'escalate',
  verify_certification: 'verify_notary',
};

export function resolveToolName(name: string): ToolName | undefined {
  if (name in toolSchemas) return name as ToolName;
  return TOOL_ALIASES[name];
}
