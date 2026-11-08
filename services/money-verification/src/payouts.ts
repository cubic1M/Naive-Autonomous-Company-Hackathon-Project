import type { Env } from './env.js';
import { InvalidStateError, NotFoundError, RequiresApprovalError } from './errors.js';
import { fire, type Hooks } from './hooks.js';
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
 * and amount <= PAYOUT_CAP_CENTS (or `allowLarge`, used by release_payout_large after the CEO agent's approval).
 * A worker whose account is missing or not yet payout-ready gets a `pending_onboarding` payouts row and an
 * onboarding link instead of a transfer; completePendingPayoutsForWorker finishes it later.
 * `accountReady` lets the account.updated webhook skip the accounts.retrieve round trip it just made.
 * Idempotent: Stripe key `payout:<jobId>`; ledger keys `payout:<jobId>` and `fee:<jobId>`.
 */
export async function payWorker(
  deps: PayoutDeps,
  jobId: string,
  opts: { allowLarge?: boolean; accountReady?: boolean } = {},
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

  // All refusals run before any Stripe account is created for the worker.
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
    throw new RequiresApprovalError(amount, deps.env.PAYOUT_CAP_CENTS, 'payout');
  }

  // First payout: no account yet, so the worker connects a bank account now.
  if (!worker.stripe_connect_account) {
    return parkPendingOnboarding(deps, job.id, worker, amount);
  }
  const accountId = worker.stripe_connect_account;
  // Stripe rejects transfers to Express accounts whose `transfers` capability is not active,
  // so an unfinished account waits for the account.updated webhook instead of failing here.
  const ready = opts.accountReady === true ? true : await isPayoutReady(deps, accountId);
  if (!ready) return parkPendingOnboarding(deps, job.id, worker, amount);

  return transferToWorker(deps, { jobId, workerId: worker.id, accountId, amount, feeCents: job.fee_cents });
}

/** Persist a pending_onboarding payouts row with a fresh onboarding link (links are single-use and expire). */
async function parkPendingOnboarding(
  deps: PayoutDeps,
  jobId: string,
  worker: Worker,
  amountCents: number,
): Promise<PayWorkerResult> {
  const { url, accountId } = await createOnboardingLink(deps, worker);
  await deps.repo.upsertPayout({
    job_id: jobId,
    worker_id: worker.id,
    amount_cents: amountCents,
    status: 'pending_onboarding',
    stripe_transfer_id: null,
    stripe_connect_account: accountId,
    onboarding_url: url,
  });
  return { status: 'pending_onboarding', accountId, onboardingUrl: url, amountCents };
}

/** Create the Transfer, write the ledger lines and payouts row, then wake the job state machine. */
async function transferToWorker(
  deps: PayoutDeps,
  p: { jobId: string; workerId: string; accountId: string; amount: number; feeCents: number },
): Promise<PayWorkerResult> {
  const { jobId, workerId, accountId, amount } = p;
  const captureLine = await deps.repo.getLedgerByKey(`escrow_capture:${jobId}`);
  const sourceCharge = captureLine?.stripe_ref ?? undefined;

  const transfer = await deps.stripe.transfers.create(
    {
      amount,
      currency: 'usd',
      destination: accountId,
      transfer_group: transferGroup(jobId),
      ...(sourceCharge && sourceCharge.startsWith('ch_') ? { source_transaction: sourceCharge } : {}),
      metadata: { job_id: jobId, worker_id: workerId },
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
    amountCents: p.feeCents,
    idempotencyKey: `fee:${jobId}`,
    stripeRef: sourceCharge ?? null,
  });
  await deps.repo.upsertPayout({
    job_id: jobId,
    worker_id: workerId,
    amount_cents: amount,
    status: 'paid',
    stripe_transfer_id: transfer.id,
    stripe_connect_account: accountId,
    onboarding_url: null,
  });
  await fire(deps.hooks, 'onWorkerPaid', jobId, workerId, transfer.id);
  return { status: 'paid', transferId: transfer.id, amountCents: amount, transferred: true };
}

/**
 * account.updated with payouts_enabled: complete every `pending_onboarding` payout for this worker.
 * Each completion goes through payWorker() so the same checks and idempotency keys apply.
 * allowLarge is correct here: the cap check already passed (or the CEO agent approved via release_payout_large)
 * when the pending row was created, so re-running it would wrongly block an approved large payout.
 * Errors propagate; the webhook layer decides about retries.
 */
export async function completePendingPayoutsForWorker(deps: PayoutDeps, workerId: string): Promise<PayWorkerResult[]> {
  const pending = await deps.repo.listPayoutsByWorker(workerId, 'pending_onboarding');
  const results: PayWorkerResult[] = [];
  for (const payout of pending) {
    results.push(await payWorker(deps, payout.job_id, { accountReady: true, allowLarge: true }));
  }
  return results;
}
