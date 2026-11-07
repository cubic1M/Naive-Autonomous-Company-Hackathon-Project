import type { Env } from './env.js';
import { InvalidStateError, NotFoundError, RequiresApprovalError } from './errors.js';
import type { Hooks } from './hooks.js';
import * as ledger from './ledger.js';
import type { Repo } from './repo.js';
import type { StripeClient } from './stripe-client.js';
import type { Worker } from './types.js';
import { transferGroup } from './escrow.js';

export interface PayoutDeps {
  stripe: StripeClient;
  repo: Repo;
  env: Pick<Env, 'PUBLIC_BASE_URL' | 'PAYOUT_CAP_CENTS'>;
  hooks?: Hooks;
  now?: () => Date;
}

/** Express connected account (US, transfers capability). Persists the id on workers.stripe_connect_account. */
export async function createConnectAccount(deps: PayoutDeps, worker: Worker): Promise<{ accountId: string }> {
  if (worker.stripe_connect_account) return { accountId: worker.stripe_connect_account };
  const account = await deps.stripe.accounts.create(
    {
      type: 'express',
      country: 'US',
      business_type: 'individual',
      capabilities: { transfers: { requested: true } },
      business_profile: { product_description: 'Independent contractor completing physical and notarial tasks via Operis' },
      metadata: { worker_id: worker.id },
    },
    { idempotencyKey: `connect:${worker.id}` },
  );
  await deps.repo.setWorkerConnectAccount(worker.id, account.id);
  return { accountId: account.id };
}

/** Hosted Express onboarding link. Creates the account first if the worker has none. */
export async function createOnboardingLink(deps: PayoutDeps, worker: Worker): Promise<{ url: string; accountId: string }> {
  const { accountId } = await createConnectAccount(deps, worker);
  const base = deps.env.PUBLIC_BASE_URL;
  const link = await deps.stripe.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    refresh_url: `${base}/join/${worker.id}/payouts?refresh=1`,
    return_url: `${base}/join/${worker.id}/payouts/done`,
  });
  return { url: link.url, accountId };
}

/** True when the connected account can receive payouts (account.updated webhook carries the same flag). */
export async function isPayoutReady(deps: Pick<PayoutDeps, 'stripe'>, accountId: string): Promise<boolean> {
  const acct = await deps.stripe.accounts.retrieve(accountId);
  return Boolean(acct.payouts_enabled) && acct.capabilities?.transfers === 'active';
}

export type PayWorkerResult =
  | {
      status: 'paid';
      transferId: string;
      amountCents: number;
      /** false if the payout already existed (idempotent repeat). */
      transferred: boolean;
    }
  | {
      /** Worker has no connected account yet: the payouts row is parked as pending_onboarding until account.updated. */
      status: 'pending_onboarding';
      accountId: string;
      onboardingUrl: string;
      amountCents: number;
    };

/**
 * Transfer worker_pay_cents to the worker's connected account.
 * Refuses unless: latest proof review for the job is `approved`, the escrow is `captured`,
 * and amount <= PAYOUT_CAP_CENTS (or `allowLarge`, used by release_payout_large after human approval in Naive).
 * Idempotent: Stripe key `payout:<jobId>`; ledger keys `payout:<jobId>` and `fee:<jobId>`.
 */
export async function payWorker(
  deps: PayoutDeps,
  jobId: string,
  opts: { allowLarge?: boolean } = {},
): Promise<PayWorkerResult> {
  const already = await deps.repo.getLedgerByKey(`payout:${jobId}`);
  if (already) {
    return { status: 'paid', transferId: already.stripe_ref ?? '', amountCents: already.amount_cents, transferred: false };
  }

  const job = await deps.repo.getJob(jobId);
  if (!job) throw new NotFoundError('job', jobId);
  if (!job.worker_id) throw new InvalidStateError(`job ${jobId} has no worker`);
  const worker = await deps.repo.getWorker(job.worker_id);
  if (!worker) throw new NotFoundError('worker', job.worker_id);
  if (!worker.stripe_connect_account) throw new InvalidStateError(`worker ${worker.id} has no connected account`);

  const review = await deps.repo.getLatestProofReviewForJob(jobId);
  if (!review || review.decision !== 'approved') {
    throw new InvalidStateError(`job ${jobId} proof is ${review?.decision ?? 'not reviewed'}; payout requires approved`);
  }
  const escrow = await deps.repo.getEscrow(jobId);
  if (!escrow || escrow.status !== 'captured') {
    throw new InvalidStateError(`escrow for job ${jobId} is ${escrow?.status ?? 'missing'}; payout requires captured`);
  }
  const amount = job.worker_pay_cents;
  if (!Number.isInteger(amount) || amount <= 0) throw new InvalidStateError(`job ${jobId} worker_pay_cents invalid`);
  if (amount > deps.env.PAYOUT_CAP_CENTS && !opts.allowLarge) {
    throw new RequiresApprovalError(amount, deps.env.PAYOUT_CAP_CENTS);
  }
  const captureLine = await deps.repo.getLedgerByKey(`escrow_capture:${jobId}`);
  const sourceCharge = captureLine?.stripe_ref ?? undefined;

  const transfer = await deps.stripe.transfers.create(
    {
      amount,
      currency: 'usd',
      destination: worker.stripe_connect_account,
      transfer_group: transferGroup(jobId),
      ...(sourceCharge && sourceCharge.startsWith('ch_') ? { source_transaction: sourceCharge } : {}),
      metadata: { job_id: jobId, worker_id: worker.id },
    },
    { idempotencyKey: `payout:${jobId}` },
  );
  await ledger.record(deps.repo, {
    jobId,
    kind: 'payout',
    amountCents: amount,
    idempotencyKey: `payout:${jobId}`,
    stripeRef: transfer.id,
  });
  await ledger.record(deps.repo, {
    jobId,
    kind: 'fee',
    amountCents: job.fee_cents,
    idempotencyKey: `fee:${jobId}`,
    stripeRef: sourceCharge ?? null,
  });
  return { status: 'paid', transferId: transfer.id, amountCents: amount, transferred: true };
}

/**
 * account.updated with payouts_enabled: complete every `pending_onboarding` payout for this worker.
 * Each completion goes through payWorker() so the same checks and idempotency keys apply.
 * Stub: implemented in P1 step 2 (payouts table + first-payout onboarding).
 */
export async function completePendingPayoutsForWorker(deps: PayoutDeps, workerId: string): Promise<PayWorkerResult[]> {
  void deps;
  void workerId;
  throw new Error('completePendingPayoutsForWorker: not implemented yet');
}
