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
  if (real && !forcedMock) return { impl: real as any, source: "real" };
  const mock = mocks[name];
  if (!mock) throw new Error(`no implementation for ${name}`);
  return { impl: mock as any, source: "mock" };
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
