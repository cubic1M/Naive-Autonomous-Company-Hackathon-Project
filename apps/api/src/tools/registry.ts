// Picks mock or real for each internal tool.
//   USE_MOCKS=true        → every tool uses its mock
//   MOCK_TOOLS=a,b        → force these tools to mock (fast rollback on stage)
//   otherwise             → real if the owner exported it from services/<area>/index.ts, else mock
import type { ServiceModule, ToolName, ToolContext } from "@contracts/runtime";
import outreach from "@services/outreach";
import verify from "@services/verify";
import payments from "@services/payments";
import { mocks } from "./mocks";
import { getJob } from "./edwin";
import { flag, list } from "@/lib/env";

const REAL: ServiceModule = { ...outreach, ...verify, ...payments };

export const INTERNAL_TOOLS: ToolName[] = [
  "get_job", "find_people", "send_blast", "check_proof", "approve_proof", "escalate",
  "capture_payment", "payout", "refund", "ledger",
];

export function resolveTool(name: ToolName): { impl: (input: any, ctx: ToolContext) => Promise<any>; source: "real" | "mock" } {
  if (name === "get_job") return { impl: getJob, source: "real" };
  const forcedMock = flag("USE_MOCKS") || list("MOCK_TOOLS").includes(name);
  const real = REAL[name];
  if (real && !forcedMock) return { impl: real as any, source: "real" };
  const mock = mocks[name];
  if (!mock) throw new Error(`no implementation for ${name}`);
  return { impl: mock as any, source: "mock" };
}

export function toolSources() {
  return Object.fromEntries(INTERNAL_TOOLS.map((t) => [t, resolveTool(t).source]));
}

/** Cameron's Stripe hold, if implemented (services/payments exports createHold). */
export const createHold = (payments as any).createHold as undefined | ((jobId: string) => Promise<{ escrow_url: string }>);
