// GET: data for Dora's live dashboard.
import { sql } from "@/lib/db";
import { authAdmin } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!authAdmin(req)) return Response.json({ error: "unauthorized: admin key required" }, { status: 401 });
  const jobs = await sql`
    select id, title, status, address, lat, lng, budget_usd, worker_id, updated_at from jobs
    order by created_at desc limit 20`;
  const timeline = await sql`select job_id, event, naive_session_id, created_at from wake_events order by created_at desc limit 50`;
  const agentFeed = await sql`select type, agent_id, session_id, summary, created_at from agent_events order by created_at desc limit 30`;
  const money = await sql`select kind, coalesce(sum(amount_usd),0)::float as total from ledger group by kind`;
  const totals = Object.fromEntries(money.map((r: any) => [r.kind, r.total]));
  const active = jobs.find((j: any) => !["paid", "refunded", "cancelled", "rejected", "expired"].includes(j.status)) ?? null;
  return Response.json({ active_job: active, jobs, timeline, agent_feed: agentFeed,
    money: { revenue: totals.capture ?? 0, payouts: totals.payout ?? 0, fees: totals.fee ?? 0, refunds: totals.refund ?? 0 } });
}
