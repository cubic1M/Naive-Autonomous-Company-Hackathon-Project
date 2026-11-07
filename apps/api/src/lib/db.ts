import postgres from "postgres";
import { TRANSITIONS, type JobState } from "@contracts/states";

const g = globalThis as unknown as { __sql?: postgres.Sql };
// prepare:false so it works through Neon's pooled (pgbouncer) connection string.
export const sql: postgres.Sql = (g.__sql ??= postgres(process.env.DATABASE_URL ?? "postgres://localhost/operis", {
  max: 5,
  prepare: false,
  idle_timeout: 20,
}));

export class TransitionError extends Error {
  constructor(public jobId: string, public to: JobState, public current: string | null) {
    super(current === null ? `job ${jobId} not found` : `job ${jobId}: cannot move ${current} → ${to}`);
  }
}

/** States that are allowed to move into `to`. */
function sourcesFor(to: JobState): JobState[] {
  return (Object.keys(TRANSITIONS) as JobState[]).filter((from) => TRANSITIONS[from].includes(to));
}

/**
 * Atomically move a job to `to`. Only succeeds if the current state may transition to `to`
 * (contracts/states.ts). Concurrent callers race safely: exactly one wins.
 */
export async function transitionJob(jobId: string, to: JobState, patch: Record<string, unknown> = {}) {
  const from = sourcesFor(to);
  const values = { ...patch, status: to, updated_at: new Date() };
  const rows = await sql`
    update jobs set ${sql(values as Record<string, any>)}
    where id = ${jobId} and status in ${sql(from)}
    returning *`;
  if (rows.length === 0) {
    const [cur] = await sql`select status from jobs where id = ${jobId}`;
    throw new TransitionError(jobId, to, cur?.status ?? null);
  }
  return rows[0] as Record<string, any>;
}

export async function addLedger(jobId: string | null, kind: string, amountUsd: number, ref?: string) {
  await sql`insert into ledger (job_id, kind, amount_usd, ref) values (${jobId}, ${kind}, ${amountUsd}, ${ref ?? null})`;
}
