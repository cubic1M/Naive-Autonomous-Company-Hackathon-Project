// Periodic sweep (Vercel cron, every 5 min): expire overdue jobs and nudge Ops when nobody accepts.
import { sql, TransitionError } from "./db";
import { transition } from "./jobs";
import { wake } from "./naive";
import { makeContext } from "@/tools/context";
import { resolveTool } from "@/tools/registry";

const NUDGES = [
  { afterMin: 15, event: "no_taker_1" },
  { afterMin: 45, event: "no_taker_2" },
];

export async function sweep() {
  const report = { cancelled: 0, expired: 0, refunded: 0, nudged: 0, errors: [] as string[] };

  // 1. Past the deadline and nobody delivered: stop the job and give the customer their money back.
  const overdue = await sql`
    select id, status from jobs
    where deadline < now() and status in ('requested', 'held', 'outreach', 'accepted')`;
  for (const j of overdue) {
    try {
      if (j.status === "requested" || j.status === "held") {
        // requested: nothing was held. held: the hold is released by payments when the job is cancelled.
        await transition(j.id, "cancelled");
        report.cancelled++;
        continue;
      }
      await transition(j.id, "expired");
      report.expired++;
      const { impl } = resolveTool("refund");
      await impl({ job_id: j.id, reason: "deadline passed without an accepted proof" }, makeContext());
      report.refunded++;
    } catch (e) {
      if (!(e instanceof TransitionError)) report.errors.push(`${j.id}: ${String(e).slice(0, 120)}`);
    }
  }

  // 2. Outreach with no taker: wake Ops to widen the search (each nudge at most once per job).
  for (const n of NUDGES) {
    const stuck = await sql`
      select j.id from jobs j
      where j.status = 'outreach' and j.deadline > now()
        and j.updated_at < now() - make_interval(mins => ${n.afterMin})
        and not exists (select 1 from wake_events w where w.job_id = j.id and w.event = ${n.event})`;
    for (const j of stuck) {
      try {
        const r = await wake("ops", j.id, n.event,
          `Job ${j.id} has had no taker for ${n.afterMin}+ minutes. Read it with get_job and follow the worker-sourcing skill's "If nobody accepts" steps (widen the search, then send_blast to new candidates). Note what you did on the board card.`);
        if (!("skipped" in r)) report.nudged++;
      } catch (e) {
        report.errors.push(`nudge ${j.id}: ${String(e).slice(0, 120)}`);
      }
    }
  }
  return report;
}
