// Periodic sweep (Vercel cron, every 5 min): expire overdue jobs, finish liability decisions, release card holds of
// cancelled jobs, and nudge Ops when nobody accepts.
import { sql, TransitionError } from "./db";
import { transition } from "./jobs";
import { wake } from "./naive";
import { makeContext } from "@/tools/context";
import { resolveTool } from "@/tools/registry";
import { afterDecision } from "@/tools/liability";
import * as compliance from "@services/compliance/index";
import * as payments from "@services/payments/index";

const NUDGES = [
  { afterMin: 15, event: "no_taker_1" },
  { afterMin: 45, event: "no_taker_2" },
];

export async function sweep() {
  const report = { cancelled: 0, expired: 0, refunded: 0, nudged: 0, liability: 0, redriven: 0, holdsReleased: 0, holdsExpired: 0, errors: [] as string[] };
  // job_liability arrives with migration 0003 (42P01 until then): the liability steps find nothing. Other errors are reported.
  const noLiabilityRows = (step: string) => (e: any) => {
    if (e?.code !== "42P01") report.errors.push(`${step}: ${String(e).slice(0, 120)}`);
    return [] as any[];
  };

  // 1. Past the deadline and nobody delivered: stop the job and give the customer their money back.
  const overdue = await sql`
    select id, status from jobs
    where deadline < now() and status in ('requested', 'held', 'outreach', 'accepted')`;
  for (const j of overdue) {
    try {
      if (j.status === "requested" || j.status === "held") {
        // requested: nothing was paid. held: transition() releases the card hold right after the cancel (step 4 retries it).
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

  // 2. Funded jobs with no liability decision fifteen minutes after they entered held (jobs.updated_at, which the
  //    transition sets): decide by the intake tags. Not keyed on the held wake event, which wake() deletes when Naive fails.
  const undecided = await sql`
    select j.id from jobs j
    left join job_liability l on l.job_id = j.id
    where j.status = 'held' and (l.job_id is null or l.model is null)
      and j.updated_at < now() - interval '15 minutes'`.catch(noLiabilityRows("liability fallback"));
  for (const j of undecided) {
    try {
      const out = await compliance.fallbackDecision(j.id);
      await afterDecision(j.id, out);
      report.liability++;
    } catch (e) {
      report.errors.push(`${j.id}: ${String(e).slice(0, 120)}`);
    }
  }

  // 3. Decisions whose follow-up did not happen (a CEO wake or a hold release that failed): drive them again from
  //    state: held jobs refused, or cleared without a liability_decided wake. (A refused job already cancelled whose
  //    hold is still open is step 4's.) Legacy decisions (migration 0004) were dispatched by the old flow; two
  //    minutes leave the agent's own call time to finish.
  const pending = await sql`
    select j.id, l.model, l.reason from jobs j
    join job_liability l on l.job_id = j.id
    where l.model is not null and l.decided_by <> 'legacy' and l.decided_at < now() - interval '2 minutes'
      and j.status = 'held' and (l.model = 'refuse'
        or not exists (select 1 from wake_events w where w.job_id = j.id and w.event = 'liability_decided'))`
    .catch(noLiabilityRows("liability re-drive"));
  for (const j of pending) {
    try {
      await afterDecision(j.id, { model: j.model, next: j.model === "refuse" ? "cancel" : "wake_ceo", reason: j.reason ?? "" });
      report.redriven++;
    } catch (e) {
      report.errors.push(`redrive ${j.id}: ${String(e).slice(0, 120)}`);
    }
  }

  // 4. Card holds (Cameron's services/payments): a cancelled job whose hold is still open, because the release after
  //    the cancel failed, is released again; then every authorized hold whose card authorization has expired.
  const openHolds = await sql`
    select j.id from jobs j join escrows e on e.job_id = j.id
    where j.status = 'cancelled' and e.status in ('pending', 'authorized') and j.updated_at < now() - interval '2 minutes'`
    .catch((e: any) => {
      report.errors.push(`open holds: ${String(e).slice(0, 120)}`);
      return [] as any[];
    });
  for (const j of openHolds) {
    try {
      if ((await payments.releaseCancelledHold(j.id, "job cancelled (sweep retry)")).released) report.holdsReleased++;
    } catch (e) {
      report.errors.push(`hold ${j.id}: ${String(e).slice(0, 120)}`);
    }
  }
  try {
    report.holdsExpired = await payments.expireStaleHolds();
  } catch (e) {
    report.errors.push(`expire holds: ${String(e).slice(0, 120)}`);
  }

  // 5. Outreach with no taker: wake Ops to widen the search (each nudge at most once per job).
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
