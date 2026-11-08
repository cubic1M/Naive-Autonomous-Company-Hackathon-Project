// Cameron: real Finance tools for apps/api's registry (apps/api/src/tools/registry.ts prefers these over
// the mocks). Shapes: contracts/tools.ts; runtime: contracts/runtime.ts. Logic lives in
// services/money-verification; this file only binds it to the API's ToolContext. The context's
// transition() is how the package's hooks move the job (held / paid / refunded), so no apps/api import.
import type { ServiceModule, ToolContext } from "../../contracts/runtime";
import {
  createContractTools,
  createEscrow,
  createOnboardingLink,
  createPaymentSetupLink as createCustomerPaymentSetupLink,
  depsFromApiContext,
  depsFromProcessEnv,
  handleStripeWebhook,
  type ApiContext,
} from "../money-verification/src/index";

const tools = (ctx: ToolContext) => createContractTools(depsFromApiContext(ctx as ApiContext));

const payments: ServiceModule = {
  capture_payment: (input, ctx) => tools(ctx).capture_payment(input),
  payout: (input, ctx) => tools(ctx).payout(input),
  refund: (input, ctx) => tools(ctx).refund(input),
  ledger: (input, ctx) => tools(ctx).ledger(input),
};
export default payments;

export interface CreateHoldOptions {
  /** Stripe PaymentMethod id (pm_...) the customer agent passed as request_human `payment.payment_method`. */
  paymentMethod?: string;
}

export interface CreateHoldResult {
  /** Checkout URL for a human to pay at, or null when the job is funded already. */
  escrow_url: string | null;
  /** true: the card is authorized now; request_human should transition the job to `held` and answer status "held". */
  funded: boolean;
  /** Why a passed or saved card was not charged (card_declined, authentication_required, invalid_payment_method, ...). */
  fallback_reason?: string;
  /** One-line instruction for the customer agent, ready to return as request_human `next_step`. */
  next_step: string;
}

const PAYMENT_SETUP = "POST /v1/customers/payment-setup";

function nextStep(r: { funded: boolean; fallback_reason?: string }): string {
  if (r.funded) {
    return "Funded: your card is held and charged only when proof passes. We're finding a verified person now. Call get_job every 2-5 minutes (or wait for your callback_url); status 'paid' means proof is ready.";
  }
  if (r.fallback_reason) {
    return `Your card could not be charged (${r.fallback_reason}). Either have your human owner pay escrow_url once, or save another card with ${PAYMENT_SETUP} and request again.`;
  }
  return `Payment needed: have your human owner pay escrow_url once (the card is held, charged only when proof passes), or save a card with ${PAYMENT_SETUP} so your next jobs are funded instantly with no link.`;
}

/**
 * Called by request_human (registry.createHold) before any agent is involved. With an instrument (payment_method
 * passed in the call, else the customer's card on file) the card is authorized right here and the job is funded
 * when this returns: escrow_url null, funded true, and request_human should move the job to `held` itself. Without
 * one (or when the card is declined: fallback_reason) it returns the manual-capture Checkout URL and the Stripe
 * webhook funds the job later. Needs DATABASE_URL and STRIPE_SECRET_KEY; until the migration has run, set
 * MOCK_PAYMENTS=true so the API keeps its mock.
 */
export async function createHold(jobId: string, opts: CreateHoldOptions = {}): Promise<CreateHoldResult> {
  const deps = depsFromProcessEnv();
  const job = await deps.repo.getJob(jobId);
  if (!job) throw new Error(`job ${jobId} not found`);
  const r = await createEscrow(deps, job, { paymentMethod: opts.paymentMethod });
  return { escrow_url: r.url, funded: r.funded, ...(r.fallback_reason ? { fallback_reason: r.fallback_reason } : {}), next_step: nextStep(r) };
}

/**
 * Called by POST /v1/worker/payout-setup (Dora's /payout screen): a Stripe Connect Express onboarding link
 * for the worker, creating the connected account on first use (idempotent per worker).
 */
export async function createPayoutLink(workerId: string): Promise<{ url: string }> {
  const deps = depsFromProcessEnv();
  const worker = await deps.repo.getWorker(workerId);
  if (!worker) throw new Error(`worker ${workerId} not found`);
  const { url } = await createOnboardingLink(deps, worker);
  return { url };
}

/**
 * Called by POST /v1/customers/payment-setup (customer agent, Bearer opk_ key): a Stripe Checkout link in setup mode
 * that saves a card on the customer's Stripe Customer (created on first use). Once the checkout.session.completed
 * webhook stores the card, every request_human from that customer is funded directly: escrow_url null, status held.
 */
export async function createPaymentSetupLink(customerId: string): Promise<{ url: string }> {
  const deps = depsFromProcessEnv();
  const { url } = await createCustomerPaymentSetupLink(deps, customerId);
  return { url };
}

/**
 * Drop-in body for apps/api/src/app/webhooks/stripe/route.ts:
 *   export const POST = (req: Request) => stripeWebhook(req, { sql, transition, baseUrl: baseUrl(), log: console.log });
 * Verifies the signature over the raw body, dedupes on event id, handles checkout.session.completed (payment
 * mode funds the job, setup mode saves a customer's card), payment_intent.amount_capturable_updated,
 * payment_intent.canceled, charge.refunded, refund.created/updated, account.updated, charge.dispute.* and
 * identity.verification_session.verified/requires_input/canceled (worker identity, services/verify), and
 * moves the job through ctx.transition().
 */
export function stripeWebhook(req: Request, ctx: ApiContext): Promise<Response> {
  return handleStripeWebhook(depsFromApiContext(ctx), req);
}
