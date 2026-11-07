import type Stripe from 'stripe';
import { NotFoundError } from './errors.js';
import { fire, type Hooks } from './hooks.js';
import * as ledger from './ledger.js';
import type { Repo } from './repo.js';
import type { StripeClient } from './stripe-client.js';
import type { Dispute, DisputeStatus, Escrow, Job, LedgerEntry, Proof, ProofReview } from './types.js';

export interface DisputeDeps {
  stripe: StripeClient;
  repo: Repo;
  hooks?: Hooks;
  now?: () => Date;
}

const CLOSED_STATUSES: readonly DisputeStatus[] = ['won', 'lost', 'warning_closed'];

/** Stripe expands some references into objects depending on the call; we only ever need the id. */
export function idOf(x: string | { id: string } | null | undefined): string | null {
  if (!x) return null;
  return typeof x === 'string' ? x : x.id;
}

const fromUnix = (seconds: number): Date => new Date(seconds * 1000);

/**
 * Find the job a dispute belongs to: via the PaymentIntent's escrow first, else via the capture ledger line
 * whose stripe_ref is the disputed charge. Disputes sometimes arrive without a payment_intent, hence the fallback.
 */
async function resolveJobId(repo: Repo, dispute: Stripe.Dispute): Promise<string | null> {
  const piId = idOf(dispute.payment_intent);
  if (piId) {
    const escrow = await repo.getEscrowByPaymentIntent(piId);
    if (escrow) return escrow.job_id;
  }
  const chargeId = idOf(dispute.charge);
  if (chargeId) {
    const lines = await repo.findLedgerByStripeRef(chargeId);
    const capture = lines.find((l) => l.kind === 'escrow_capture');
    if (capture?.job_id) return capture.job_id;
  }
  return null;
}

/**
 * Upsert the disputes row from a charge.dispute.* event and book the loss when Stripe says we lost.
 * Idempotent: the row is keyed by dispute id, the hook fires only when the row is first created by a
 * 'created' event, and the dispute_loss ledger line has a per-dispute idempotency key.
 */
export async function recordDisputeEvent(deps: DisputeDeps, event: Stripe.Event): Promise<Dispute> {
  const dispute = event.data.object as Stripe.Dispute;
  const now = deps.now?.() ?? new Date();
  const existing = await deps.repo.getDispute(dispute.id);
  const jobId = existing?.job_id ?? (await resolveJobId(deps.repo, dispute));
  const status = dispute.status as DisputeStatus;
  const dueBy = dispute.evidence_details?.due_by;

  const row = await deps.repo.upsertDispute({
    id: dispute.id,
    job_id: jobId,
    stripe_charge_id: idOf(dispute.charge) ?? '',
    stripe_payment_intent_id: idOf(dispute.payment_intent),
    amount_cents: dispute.amount,
    currency: dispute.currency,
    reason: dispute.reason ?? null,
    status,
    evidence_due_by: dueBy ? fromUnix(dueBy) : null,
    // Our stored evidence is richer than Stripe's echo of it, so never overwrite it from the event.
    evidence: existing?.evidence ?? {},
    evidence_submitted_at: existing?.evidence_submitted_at ?? null,
    opened_at: existing?.opened_at ?? fromUnix(event.created),
    closed_at: CLOSED_STATUSES.includes(status) ? (existing?.closed_at ?? now) : null,
  });

  if (event.type === 'charge.dispute.created' && !existing) {
    await fire(deps.hooks, 'onDisputeOpened', dispute.id, jobId);
  }
  if (status === 'lost') {
    await ledger.record(deps.repo, {
      jobId,
      kind: 'dispute_loss',
      amountCents: dispute.amount,
      idempotencyKey: `dispute_loss:${dispute.id}`,
      stripeRef: dispute.id,
    });
  }
  return row;
}

export interface DisputeBundle {
  dispute: Dispute;
  job: Job | null;
  escrow: Escrow | null;
  proofReview: ProofReview | null;
  proofs: Proof[];
  ledger: LedgerEntry[];
}

/** Everything the Disputes agent needs to argue a chargeback, in one read. Null when the dispute is unknown. */
export async function getDisputeBundle(deps: Pick<DisputeDeps, 'repo'>, disputeId: string): Promise<DisputeBundle | null> {
  const { repo } = deps;
  const dispute = await repo.getDispute(disputeId);
  if (!dispute) return null;
  const jobId = dispute.job_id;
  if (!jobId) return { dispute, job: null, escrow: null, proofReview: null, proofs: [], ledger: [] };
  const [job, escrow, proofReview, proofs, lines] = await Promise.all([
    repo.getJob(jobId),
    repo.getEscrow(jobId),
    repo.getLatestProofReviewForJob(jobId),
    repo.getProofsForJob(jobId),
    repo.listLedger({ jobId }),
  ]);
  return { dispute, job, escrow, proofReview, proofs, ledger: lines };
}

/**
 * Draft (default) or submit evidence to Stripe. Drafting first lets the agent iterate and a founder do the
 * irreversible submit. No idempotency key: successive drafts carry different evidence and must not be replayed.
 */
export async function submitDisputeEvidence(
  deps: DisputeDeps,
  disputeId: string,
  evidence: Stripe.DisputeUpdateParams.Evidence,
  opts: { submit?: boolean } = {},
): Promise<Dispute> {
  const existing = await deps.repo.getDispute(disputeId);
  if (!existing) throw new NotFoundError('dispute', disputeId);
  const submit = opts.submit ?? false;
  await deps.stripe.disputes.update(disputeId, { evidence, submit });
  const now = deps.now?.() ?? new Date();
  const { updated_at: _updatedAt, ...base } = existing;
  return deps.repo.upsertDispute({
    ...base,
    evidence: { ...existing.evidence, ...evidence },
    ...(submit ? { evidence_submitted_at: now, status: 'under_review' as const } : {}),
  });
}
