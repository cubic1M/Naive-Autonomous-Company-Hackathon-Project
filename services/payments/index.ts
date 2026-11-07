// Cameron: real Finance tools for apps/api's registry (apps/api/src/tools/registry.ts prefers these over
// the mocks). Shapes: contracts/tools.ts; runtime: contracts/runtime.ts. Logic lives in
// services/money-verification; this file only binds it to the API's ToolContext. The context's
// transition() is how the package's hooks move the job (held / paid / refunded), so no apps/api import.
import type { ServiceModule, ToolContext } from "../../contracts/runtime";
import {
  createContractTools,
  createEscrow,
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

/**
 * Called by request_human (registry.createHold) before any agent is involved: creates the manual-capture
 * Checkout session for the job and returns the URL the customer agent pays at.
 */
export async function createHold(jobId: string): Promise<{ escrow_url: string }> {
  const deps = depsFromProcessEnv();
  const job = await deps.repo.getJob(jobId);
  if (!job) throw new Error(`job ${jobId} not found`);
  const { url } = await createEscrow(deps, job);
  return { escrow_url: url };
}

/**
 * Drop-in body for apps/api/src/app/webhooks/stripe/route.ts:
 *   export const POST = (req: Request) => stripeWebhook(req, { sql, transition, baseUrl: baseUrl(), log: console.log });
 * Verifies the signature over the raw body, dedupes on event id, handles checkout.session.completed,
 * payment_intent.canceled, charge.refunded, account.updated and charge.dispute.*, and moves the job
 * through ctx.transition().
 */
export function stripeWebhook(req: Request, ctx: ApiContext): Promise<Response> {
  return handleStripeWebhook(depsFromApiContext(ctx), req);
}
