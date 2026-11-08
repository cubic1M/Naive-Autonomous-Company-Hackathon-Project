import { after } from "next/server";
import { WAKE_ON_ENTER, type JobState } from "@contracts/states";
import { sql } from "./db";
import { optional } from "./env";

const NAIVE = "https://api.vetta.sh/v1";
export type AgentRole = "ceo" | "ops" | "verifier" | "finance" | "sales" | "disputes";

const AGENT_ENV: Record<AgentRole, string> = {
  ceo: "NAIVE_AGENT_CEO",
  ops: "NAIVE_AGENT_OPS",
  verifier: "NAIVE_AGENT_VERIFIER",
  finance: "NAIVE_AGENT_FINANCE",
  sales: "NAIVE_AGENT_SALES",
  disputes: "NAIVE_AGENT_DISPUTES",
};

const MESSAGES: Partial<Record<JobState, (id: string) => string>> = {
  held: (id) =>
    `Job ${id} is funded. Read it with get_job, create a board card for it, and assign the card to the ops member to find a worker.`,
  accepted: (id) =>
    `Job ${id} was accepted by a worker. Read it with get_job, confirm the worker, and note on the board card that outreach is closed.`,
  proof_submitted: (id) =>
    `Job ${id} has a new proof. Call check_proof, then decide: approve_proof if the evidence clearly meets the requirement, otherwise escalate.`,
  approved: (id) =>
    `Job ${id} proof was approved. Call capture_payment, then payout. Report the result on the board card.`,
};

/**
 * Wake a Naïve agent for a job event. Idempotent per (job, event): retries and duplicate
 * webhooks never start a second session. The ONLY place in the codebase that calls Naïve sessions.
 */
export async function wake(role: AgentRole, jobId: string, event: string, message: string) {
  const agentId = optional(AGENT_ENV[role]);
  const key = optional("NAIVE_API_KEY");
  const claimed = await sql`
    insert into wake_events (job_id, event) values (${jobId}, ${event})
    on conflict do nothing returning job_id`;
  if (claimed.length === 0) return { skipped: "duplicate" as const };
  // Agents work against production; a local server's jobs don't exist there, so don't wake them from localhost.
  const local = /localhost|127\.0\.0\.1/.test(process.env.API_BASE_URL ?? "http://localhost");
  if (local && process.env.WAKE_FROM_LOCAL !== "true") {
    console.warn(`[wake] local server: skipped waking ${role} for job ${jobId} (${event}); set WAKE_FROM_LOCAL=true to override`);
    return { skipped: "local" as const };
  }
  if (!agentId || !key) {
    console.warn(`[wake] ${role} not configured (${AGENT_ENV[role]}); job ${jobId} event ${event} recorded only`);
    return { skipped: "not_configured" as const };
  }
  try {
    const res = await fetch(`${NAIVE}/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: agentId,
        message,
        metadata: { job_id: jobId, event },
        budget_micro_usd: Number(process.env.NAIVE_SESSION_BUDGET_MICRO_USD ?? 2_000_000),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Naïve ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    await sql`update wake_events set naive_session_id = ${body.id} where job_id = ${jobId} and event = ${event}`;
    await sql`update jobs set naive_session_id = coalesce(naive_session_id, ${body.id}) where id = ${jobId}`;
    console.log(`[wake] ${role} session ${body.id} for job ${jobId} (${event})`);
    return { session_id: body.id as string };
  } catch (err) {
    // release the claim so a retry can wake again
    await sql`delete from wake_events where job_id = ${jobId} and event = ${event}`;
    console.error(`[wake] failed`, err);
    throw err;
  }
}

/** Wake whichever agent owns a job's new state (contracts/states.ts WAKE_ON_ENTER). */
export async function wakeForState(jobId: string, state: JobState) {
  const role = WAKE_ON_ENTER[state];
  const msg = MESSAGES[state];
  if (!role || !msg) return;
  return wake(role, jobId, state, msg(jobId));
}

/** Run after the HTTP response is sent when inside a request; otherwise fire-and-forget. */
export function later(fn: () => Promise<unknown>) {
  const run = () => fn().catch((e) => console.error("[later]", e));
  try {
    after(run);
  } catch {
    void run();
  }
}
