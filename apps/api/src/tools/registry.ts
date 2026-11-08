// Picks mock or real for each internal tool.
//   USE_MOCKS=true        → every tool uses its mock
//   MOCK_TOOLS=a,b        → force these tools to mock (fast rollback on stage)
//   otherwise             → real if the owner exported it from services/<area>/index.ts, else mock
import type { ServiceModule, ToolName, ToolContext } from "@contracts/runtime";
import outreach from "@services/outreach/index";
import verify from "@services/verify/index";
import payments from "@services/payments/index";
import * as paymentsModule from "@services/payments/index";
import type { CreateHoldOptions, CreateHoldResult } from "@services/payments/index";
import growth from "@services/growth/index";
import { mocks } from "./mocks";
import { getJob } from "./edwin";
import { outreachConfigured, realFindPeople, realSendBlast } from "./outreach";
import { flag, list } from "@/lib/env";

const REAL: ServiceModule = { ...outreach, ...verify, ...payments, ...growth };

export const INTERNAL_TOOLS: ToolName[] = [
  "get_job", "find_people", "send_blast", "check_proof", "approve_proof", "escalate",
  "capture_payment", "payout", "refund", "ledger", "refund_large", "release_payout_large",
  "list_prospects", "send_marketing", "suppress_contact", "recruit_search", "recruit_invite", "growth_report", "redeem_promo",
  "reddit_research",
];

export function resolveTool(name: ToolName): { impl: (input: any, ctx: ToolContext) => Promise<any>; source: "real" | "mock" } {
  if (name === "get_job") return { impl: getJob, source: "real" };
  const forcedMock = flag("USE_MOCKS") || list("MOCK_TOOLS").includes(name);
  const real = REAL[name] ?? (outreachConfigured() ? ({ find_people: realFindPeople, send_blast: realSendBlast } as any)[name] : undefined);
  if (real && !forcedMock) return { impl: withX402Jobs(name, real as any), source: "real" };
  const mock = mocks[name];
  if (!mock) throw new Error(`no implementation for ${name}`);
  return { impl: mock as any, source: "mock" };
}

/**
 * Jobs funded in USDC over x402 (lib/x402.ts) have no Stripe charge: capture is already done (the USDC moved when the
 * agent paid), and a refund goes back in USDC (marked due for a founder) instead of through Stripe.
 */
function withX402Jobs(name: ToolName, impl: (input: any, ctx: ToolContext) => Promise<any>) {
  if (name !== "capture_payment" && name !== "refund") return impl;
  return async (input: any, ctx: ToolContext) => {
    const { isX402Funded, markX402RefundDue, x402Payment } = await import("@/lib/x402");
    if (!input?.job_id || !(await isX402Funded(input.job_id))) return impl(input, ctx);
    if (name === "capture_payment") {
      const p = await x402Payment(input.job_id);
      const usd = Number(p?.amount_micro_usd ?? 0) / 1_000_000;
      await ctx.ledger(input.job_id, "capture", usd, `x402:${p?.tx_hash ?? ""}`);
      return { job_id: input.job_id, status: "captured", amount_cents: Math.round(usd * 100), charge_id: null, paid_with: "USDC over x402", tx_hash: p?.tx_hash ?? null };
    }
    return (await markX402RefundDue(input.job_id, input.reason ?? "refund")) ?? { job_id: input.job_id, status: "refund_already_due_or_sent" };
  };
}

export function toolSources() {
  return Object.fromEntries(INTERNAL_TOOLS.map((t) => [t, resolveTool(t).source]));
}

/**
 * Cameron's Stripe hold, if implemented (services/payments exports createHold): authorizes a passed or saved card in
 * the call (funded: true, escrow_url null), else returns the Checkout URL.
 */
export const createHold = (paymentsModule as any).createHold as
  | undefined
  | ((jobId: string, opts?: CreateHoldOptions) => Promise<CreateHoldResult>);

/** Cameron's card on file, if implemented (services/payments exports createPaymentSetupLink): a setup-mode Checkout URL. */
export const createPaymentSetupLink = (paymentsModule as any).createPaymentSetupLink as
  | undefined
  | ((customerId: string) => Promise<{ url: string }>);
