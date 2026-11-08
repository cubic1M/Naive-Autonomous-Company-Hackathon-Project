import type Stripe from 'stripe';
import type { Env } from '../env.js';
import { recordDisputeEvent, idOf } from '../disputes.js';
import { markAuthorized, markRefunded, markReleased, recordStripeRefund } from '../escrow.js';
import { WebhookSignatureError } from '../errors.js';
import { fire, type Hooks } from '../hooks.js';
import { recordIdentityCanceled, recordIdentityRequiresInput, recordIdentityVerified, type IdentityOutcome } from '../identity.js';
import { completePendingPayoutsForWorker } from '../payouts.js';
import type { Repo } from '../repo.js';
import type { StripeClient } from '../stripe-client.js';

export interface WebhookDeps {
  stripe: StripeClient;
  repo: Repo;
  env: Env;
  hooks?: Hooks;
  now?: () => Date;
}

export interface HandleResult {
  type: string;
  handled: boolean;
  duplicate: boolean;
  detail?: string;
}

type Outcome = Pick<HandleResult, 'handled' | 'detail'>;

const unhandled = (detail?: string): Outcome => ({ handled: false, ...(detail ? { detail } : {}) });

/** Identity events: `changed` is whether a worker_verifications row was written (see identity.ts for the no-ops). */
const identityOutcome = (o: IdentityOutcome): Outcome => ({ handled: o.changed, detail: o.detail });

/** Checkout completed. Funds the job; works from metadata.job_id, falling back to the PaymentIntent's escrow. */
async function onCheckoutCompleted(deps: WebhookDeps, session: Stripe.Checkout.Session): Promise<Outcome> {
  if (session.mode !== 'payment') return unhandled('not a payment-mode session');
  const piId = idOf(session.payment_intent);
  // NOTE: do not gate on payment_status === 'paid'. With manual capture it stays 'unpaid' until capture,
  // even though the card is authorized, which is exactly the state we are funding on.
  let jobId = session.metadata?.job_id ?? null;
  if (!jobId && piId) jobId = (await deps.repo.getEscrowByPaymentIntent(piId))?.job_id ?? null;
  if (!jobId) return unhandled('no job_id on session and no escrow for its payment intent');
  if (!piId) return unhandled('session has no payment intent');
  const before = await deps.repo.getEscrow(jobId);
  await markAuthorized(deps, jobId, piId);
  // Fire only on the real pending -> authorized transition. A retry after a failed hook is lost, an accepted
  // trade-off versus double-waking the CEO agent.
  if (before?.status === 'pending') await fire(deps.hooks, 'onJobFunded', jobId);
  return { handled: true, detail: jobId };
}

/** Stripe canceled the authorization (e.g. it expired): release the escrow. */
async function onPaymentIntentCanceled(deps: WebhookDeps, pi: Stripe.PaymentIntent): Promise<Outcome> {
  const escrow = await deps.repo.getEscrowByPaymentIntent(pi.id);
  if (!escrow) return unhandled(`no escrow for ${pi.id}`);
  await markReleased(deps, escrow.job_id);
  return { handled: true };
}

/** Refund issued outside our code (Stripe dashboard): mirror it into escrow and ledger. */
async function onChargeRefunded(deps: WebhookDeps, charge: Stripe.Charge): Promise<Outcome> {
  const piId = idOf(charge.payment_intent);
  const escrow = piId ? await deps.repo.getEscrowByPaymentIntent(piId) : null;
  if (!escrow) return unhandled(`no escrow for charge ${charge.id}`);
  await markRefunded(deps, escrow.job_id, charge.amount_refunded, charge.id);
  return { handled: true };
}

/** One ledger line per Stripe refund (tool-made or dashboard), keyed so the tool's own write is the same row. */
async function onRefundEvent(deps: WebhookDeps, refund: Stripe.Refund): Promise<Outcome> {
  const escrow = await recordStripeRefund(deps, refund);
  if (!escrow) return unhandled(`no escrow for refund ${refund.id}`);
  return { handled: true, detail: `${refund.id} ${refund.status ?? ''}`.trim() };
}

/** Connect onboarding finished: tell the worker pipeline and flush payouts parked as pending_onboarding. */
async function onAccountUpdated(deps: WebhookDeps, account: Stripe.Account): Promise<Outcome> {
  if (account.payouts_enabled !== true || account.capabilities?.transfers !== 'active') {
    return unhandled('payouts not enabled yet');
  }
  const metaWorkerId = account.metadata?.worker_id;
  const worker =
    (metaWorkerId ? await deps.repo.getWorker(metaWorkerId) : null) ??
    (await deps.repo.getWorkerByConnectAccount(account.id));
  if (!worker) return unhandled(`no worker for account ${account.id}`);
  await fire(deps.hooks, 'onWorkerPayoutReady', worker.id);
  const results = await completePendingPayoutsForWorker(deps, worker.id);
  return { handled: true, detail: `completed ${results.length} pending payouts` };
}

/** Route one verified Stripe event to its handler. Unknown types are reported unhandled, not errors. */
export async function handleStripeEvent(deps: WebhookDeps, event: Stripe.Event): Promise<HandleResult> {
  const base = { type: event.type, duplicate: false };
  const run = async (): Promise<Outcome> => {
    switch (event.type) {
      case 'checkout.session.completed':
        return onCheckoutCompleted(deps, event.data.object as Stripe.Checkout.Session);
      case 'payment_intent.canceled':
        return onPaymentIntentCanceled(deps, event.data.object as Stripe.PaymentIntent);
      case 'charge.refunded':
        return onChargeRefunded(deps, event.data.object as Stripe.Charge);
      case 'refund.created':
      case 'refund.updated':
        return onRefundEvent(deps, event.data.object as Stripe.Refund);
      case 'account.updated':
        return onAccountUpdated(deps, event.data.object as Stripe.Account);
      case 'charge.dispute.created':
      case 'charge.dispute.updated':
      case 'charge.dispute.closed': {
        const d = await recordDisputeEvent(deps, event);
        return { handled: true, detail: `${d.id} ${d.status}` };
      }
      case 'identity.verification_session.verified':
        return identityOutcome(await recordIdentityVerified(deps, event.data.object as Stripe.Identity.VerificationSession));
      case 'identity.verification_session.requires_input':
        return identityOutcome(await recordIdentityRequiresInput(deps, event.data.object as Stripe.Identity.VerificationSession));
      case 'identity.verification_session.canceled':
        return identityOutcome(await recordIdentityCanceled(deps, event.data.object as Stripe.Identity.VerificationSession));
      default:
        return unhandled();
    }
  };
  return { ...base, ...(await run()) };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Verify the signature over the RAW body; the message never echoes the secret or the payload. */
function verify(deps: WebhookDeps, rawBody: string, header: string | null): Stripe.Event {
  if (!header) throw new WebhookSignatureError('missing stripe-signature header');
  try {
    return deps.stripe.webhooks.constructEvent(rawBody, header, deps.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    throw new WebhookSignatureError('signature verification failed');
  }
}

/**
 * Stripe webhook entry point. Order is check -> handle -> mark, so a handler that throws leaves the event
 * unmarked and the 500 makes Stripe retry. Concurrent duplicate deliveries may both run the handler; that is
 * acceptable because every handler is idempotent.
 */
export async function handleStripeWebhook(deps: WebhookDeps, req: Request): Promise<Response> {
  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = verify(deps, rawBody, req.headers.get('stripe-signature'));
  } catch (err) {
    if (err instanceof WebhookSignatureError) return json(400, { error: err.message });
    throw err;
  }
  try {
    if (await deps.repo.hasStripeEvent(event.id)) {
      return json(200, { received: true, type: event.type, duplicate: true, handled: false });
    }
    const result = await handleStripeEvent(deps, event);
    await deps.repo.markStripeEvent(event.id, event.type);
    return json(200, { received: true, type: result.type, duplicate: false, handled: result.handled });
  } catch (err) {
    // Logged (type + id only, never the body) so a failing handler is debuggable while Stripe retries it.
    console.error(`[stripe webhook] ${event.type} ${event.id} failed:`, err instanceof Error ? err.message : err);
    return json(500, { error: 'webhook handler failed; will be retried' });
  }
}

/** Curried form for route files: `export const POST = createStripeWebhookHandler(deps)`. */
export function createStripeWebhookHandler(deps: WebhookDeps): (req: Request) => Promise<Response> {
  return (req) => handleStripeWebhook(deps, req);
}
