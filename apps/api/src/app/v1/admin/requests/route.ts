// GET: every request (job) with the company that sent it, its state timeline and latest proof: the backoffice feed.
//   ?since=<iso> only rows changed after that time (for cheap polling) · ?limit=100
import { sql } from "@/lib/db";
import { authAdmin } from "@/lib/auth";
import { syncAgentFeedThrottled } from "@/lib/agentFeed";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authAdmin(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  await syncAgentFeedThrottled();
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 300);
  const since = url.searchParams.get("since");
  const rows = await sql`
    select j.id, j.title, j.instructions, j.status, j.address, j.lat, j.lng, j.deadline, j.budget_usd, j.fee_usd,
           j.worker_pay_usd, j.created_at, j.updated_at, j.callback_url is not null as has_callback,
           c.id as customer_id, c.name as company, c.contact_email,
           w.name as worker_name,
           (select count(*)::int from outreach o where o.job_id = j.id) as invited,
           (select json_agg(json_build_object('event', e.event, 'at', e.created_at, 'session', e.naive_session_id) order by e.created_at)
              from wake_events e where e.job_id = j.id) as wakes,
           (select json_build_object('media', p.media, 'score', p.verifier_score, 'status', p.status, 'notes', p.verifier_notes)
              from proofs p where p.job_id = j.id order by p.created_at desc limit 1) as proof,
           (select json_agg(x order by x.at) from (select a.agent, a.type, a.summary, a.created_at as at from agent_events a
              where a.job_id = j.id order by a.created_at desc limit 25) x) as activity
    from jobs j
    left join customers c on c.id = j.customer_id
    left join workers w on w.id = j.worker_id
    where ${since ? sql`j.updated_at > ${new Date(since)}` : sql`true`}
    order by j.created_at desc
    limit ${limit}`;
  const companies = await sql`
    select c.id, c.name, c.contact_email, c.created_at,
           count(j.id)::int as requests,
           count(j.id) filter (where j.status = 'paid')::int as paid,
           -- what the company was charged: worker pay + fee (connector jobs add the platform fee on top of the budget)
           coalesce(sum(coalesce(j.worker_pay_usd + j.fee_usd, j.budget_usd)) filter (where j.status = 'paid'), 0)::float as spend,
           max(j.created_at) as last_request_at
    from customers c left join jobs j on j.customer_id = c.id
    where c.name <> 'smoke-test'
    group by c.id order by max(j.created_at) desc nulls last, c.created_at desc limit 50`;
  const [stats] = await sql`
    select count(*) filter (where created_at > now() - interval '24 hours')::int as today,
           count(*) filter (where status not in ('paid','refunded','cancelled','rejected','expired'))::int as open,
           count(*) filter (where status = 'paid')::int as paid,
           count(*) filter (where status = 'escalated')::int as escalated,
           count(distinct customer_id)::int as companies
    from jobs`;
  const feed = await sql`select agent, type, summary, job_id, created_at from agent_events
                         where (agent is not null and type <> 'session.idle') or type = 'approval'
                         order by created_at desc limit 60`;
  const money = await sql`select kind, coalesce(sum(amount_usd),0)::float as total from ledger group by kind`;
  const m = Object.fromEntries(money.map((r: any) => [r.kind, r.total]));
  const stages = await sql`select status, count(*)::int as n from jobs
                           where customer_id not in (select id from customers where name = 'smoke-test') group by status`;
  // Calls from customer agents (api_calls, migration 012). Empty until the table exists.
  let calls: any[] = [];
  let callStats = { total_24h: 0, agents_24h: 0, errors_24h: 0, unauthorized_24h: 0, request_human_24h: 0, crawlers_24h: 0 };
  try {
    calls = await sql`select id, at, customer_id, customer_name, channel, method, tool, outcome, http_status, duration_ms, job_id, summary, client
                      from api_calls where coalesce(customer_name, '') <> 'smoke-test' order by at desc limit 150`;
    const [cs] = await sql`select count(*) filter (where outcome <> 'crawler')::int as total_24h, count(distinct customer_id)::int as agents_24h,
                             count(*) filter (where outcome = 'error')::int as errors_24h,
                             count(*) filter (where outcome = 'unauthorized')::int as unauthorized_24h,
                             count(*) filter (where tool = 'request_human')::int as request_human_24h,
                             count(*) filter (where outcome = 'crawler')::int as crawlers_24h
                           from api_calls where at > now() - interval '24 hours' and coalesce(customer_name, '') <> 'smoke-test'`;
    callStats = cs as any;
  } catch {
    // api_calls not migrated yet
  }
  return Response.json({
    now: new Date().toISOString(), stats, companies, requests: rows, feed, calls, call_stats: callStats,
    money: { revenue: m.capture ?? 0, payouts: m.payout ?? 0, fees: m.fee ?? 0, refunds: m.refund ?? 0, held: m.hold ?? 0 },
    stages: Object.fromEntries(stages.map((r: any) => [r.status, r.n])),
  });
}
