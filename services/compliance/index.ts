// services/compliance/index.ts
// Cameron: the per-job liability model for apps/api (docs/specs/2026-11-08-liability-model-design.md).
// Logic lives in services/money-verification (src/liability, src/certs/attorney.ts); this file binds it to the API.
import type { ToolContext } from "../../contracts/runtime";
import {
  NotFoundError,
  checkEligibility,
  createTools,
  decideFallback,
  depsFromApiContext,
  depsFromProcessEnv,
  quoteJob,
  releaseEscrow,
  ruleById,
  verifyAttorney,
  verifyNotary,
  type ApiContext,
  type JobQuote,
  type ToolInput,
} from "../money-verification/src/index";

export { quoteJob };
export type { JobQuote };

/** The customer-facing reason for a job whose intake tags force a refusal (L3 to L6). */
export function refusalReason(ruleId: string): string {
  const rule = ruleById(ruleId);
  return `We can't take this job yet: ${rule ? rule.title.toLowerCase() : "this kind of work"} needs a licence we can't verify (policy ${ruleId}).`;
}

/** request_human: store the intake tags and pricing next to the new job. */
export async function recordIntake(jobId: string, q: JobQuote): Promise<void> {
  await depsFromProcessEnv().repo.insertJobLiability({ job_id: jobId, tags: { rules: q.tags.rules, forced: q.tags.forced }, pricing: q.pricing });
}

const tools = (ctx: ToolContext) => createTools(depsFromApiContext(ctx as ApiContext));

/** Internal MCP tools for the Compliance agent; validation happens inside createTools. */
export const LIABILITY_TOOLS = {
  get_liability_context: (args: unknown, ctx: ToolContext) =>
    tools(ctx).get_liability_context(args as ToolInput<"get_liability_context">),
  set_liability: (args: unknown, ctx: ToolContext) => tools(ctx).set_liability(args as ToolInput<"set_liability">),
};

/** The sweep's fifteen-minute fallback. */
export async function fallbackDecision(jobId: string) {
  const out = await decideFallback(depsFromProcessEnv(), jobId);
  return { model: out.liability.model!, rule_id: out.liability.rule_id!, reason: out.liability.reason!, next: out.next, changed: out.changed };
}

/** The Ops gate: find_people / send_blast wait for a decision. */
export async function hasDecision(jobId: string): Promise<boolean> {
  return Boolean((await depsFromProcessEnv().repo.getJobLiability(jobId))?.model);
}

/** A refused job: cancel the card authorization (nothing was captured) before the job moves to cancelled. */
export async function releaseHold(jobId: string, reason: string): Promise<void> {
  try {
    await releaseEscrow(depsFromProcessEnv(), jobId, reason);
  } catch (e) {
    // No escrow means nothing was held (MOCK_PAYMENTS jobs); anything else must surface.
    if (!(e instanceof NotFoundError)) throw e;
  }
}

/** acceptJob's gate. */
export async function eligibilityForAccept(workerId: string, jobId: string) {
  const r = await checkEligibility(depsFromProcessEnv(), { workerId, jobId });
  return { eligible: r.eligible, reasons: r.reasons };
}

/** POST /v1/worker/license: the worker proves the licence a connector job needs. */
export async function verifyLicence(input: { workerId: string; jobId: string; kind: "notary" | "attorney"; number: string; name: string }): Promise<{ status: string; reasons: string[] }> {
  const deps = depsFromProcessEnv();
  if (input.kind === "attorney") {
    const r = await verifyAttorney(deps, { workerId: input.workerId, barNumber: input.number, name: input.name });
    return { status: r.status, reasons: r.reasons };
  }
  const job = await deps.repo.getJob(input.jobId);
  const r = await verifyNotary(deps, { workerId: input.workerId, commissionNumber: input.number, name: input.name, jobDate: job?.deadline ?? new Date() });
  return { status: r.status, reasons: r.reasons };
}
