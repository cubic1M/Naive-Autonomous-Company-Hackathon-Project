// Contract-shaped mocks for Andrew's and Cameron's tools. They return fake-but-plausible data
// AND move the job through its states, so the whole agent loop runs before the real tools exist.
import { randomBytes, randomInt } from "node:crypto";
import type { ServiceModule } from "@contracts/runtime";
import { distanceM } from "@/lib/geo";

const MOCK_WORKERS = [
  { name: "Maya (mock)", email: "maya.mock@operis.dev", phone: null, source: "mock:regulars" },
  { name: "Jordan (mock)", email: "jordan.mock@operis.dev", phone: null, source: "mock:reddit" },
  { name: "Sam (mock)", email: "sam.mock@operis.dev", phone: null, source: "mock:linkedin" },
];
const APPROVE_MIN = Number(process.env.APPROVE_MIN_CONFIDENCE ?? 0.85);
const PAYOUT_MAX = Number(process.env.PAYOUT_MAX_USD ?? 150);

export const mocks: Required<{ [K in keyof ServiceModule]-?: NonNullable<ServiceModule[K]> }> = {
  // ---- Andrew ----
  async find_people({ job_id, limit = 3 }, ctx) {
    const candidates = [];
    for (const w of MOCK_WORKERS.slice(0, limit)) {
      const [row] = await ctx.sql`
        insert into workers (name, email, phone, source) values (${w.name}, ${w.email}, ${w.phone}, ${w.source})
        on conflict (email) do update set name = excluded.name returning id`;
      candidates.push({ candidate_id: row.id, name: w.name, channel: "email" as const, source: w.source, distance_km: 0.4 + candidates.length, score: 0.9 - candidates.length * 0.1 });
    }
    ctx.log(`find_people(mock) job ${job_id}: ${candidates.length} candidates`);
    return { candidates };
  },

  async send_blast({ job_id, candidate_ids }, ctx) {
    const ids: string[] = [];
    for (const wid of candidate_ids) {
      const [w] = await ctx.sql`select id, opted_out from workers where id = ${wid}`;
      if (!w || w.opted_out) continue;
      const token = randomBytes(16).toString("base64url");
      const code = String(randomInt(1000, 10000));
      const [o] = await ctx.sql`
        insert into outreach (job_id, worker_id, channel, token, short_code) values (${job_id}, ${wid}, 'email', ${token}, ${code})
        returning id`;
      ids.push(o.id);
      ctx.log(`send_blast(mock) → ${ctx.baseUrl}/j/${token} (reply code ${code})`);
    }
    const [j] = await ctx.sql`select status from jobs where id = ${job_id}`;
    if (j?.status === "held") await ctx.transition(job_id, "outreach");
    return { sent: ids.length, skipped_opted_out: candidate_ids.length - ids.length, queued_manual: 0, outreach_ids: ids };
  },

  // ---- Cameron: verify ----
  async check_proof({ job_id }, ctx) {
    const [p] = await ctx.sql`
      select p.*, j.lat as job_lat, j.lng as job_lng, j.proof_requirement from proofs p join jobs j on j.id = p.job_id
      where p.job_id = ${job_id} order by p.created_at desc limit 1`;
    if (!p) throw new Error(`no proof for job ${job_id}`);
    const req = p.proof_requirement ?? {};
    const gps = p.gps_lat != null ? Math.round(distanceM(p.gps_lat, p.gps_lng, p.job_lat, p.job_lng)) : null;
    const inFence = gps !== null && gps <= (req.geofence_m ?? 150);
    const fresh = p.captured_at ? Date.now() - new Date(p.captured_at).getTime() < 6 * 3600 * 1000 : false;
    const photos = (p.media ?? []).length;
    const enough = photos >= (req.photos?.min ?? 1);
    const checklist = (req.photos?.must_show ?? []).map((item: string) => ({ item, found: enough, confidence: enough ? 0.92 : 0.2 }));
    const flags = [!inFence && "outside_geofence", !fresh && "stale_or_missing_timestamp", !enough && "not_enough_photos", gps === null && "no_gps"].filter(Boolean) as string[];
    const score = flags.length === 0 ? 0.92 : 0.4;
    await ctx.sql`update proofs set verifier_score = ${score} where id = ${p.id}`;
    return { proof_id: p.id, gps_distance_m: gps, timestamp_ok: fresh, checklist, overall_score: score, flags };
  },

  async approve_proof({ job_id, proof_id, notes }, ctx) {
    const [p] = await ctx.sql`
      select p.verifier_score, p.gps_lat, p.gps_lng, j.lat, j.lng, j.proof_requirement from proofs p join jobs j on j.id = p.job_id
      where p.id = ${proof_id} and p.job_id = ${job_id}`;
    if (!p) throw new Error("proof not found for this job");
    if (p.verifier_score == null || Number(p.verifier_score) < APPROVE_MIN) return { error: "below_threshold" as const };
    const fence = p.proof_requirement?.geofence_m ?? 150;
    if (p.gps_lat == null || distanceM(p.gps_lat, p.gps_lng, p.lat, p.lng) > fence) return { error: "outside_geofence" as const };
    await ctx.sql`update proofs set status = 'approved', verifier_notes = ${notes}, reviewed_by = 'verifier-agent' where id = ${proof_id}`;
    await ctx.transition(job_id, "approved");
    return { job_id, status: "approved" as const };
  },

  async escalate({ job_id, proof_id, reason }, ctx) {
    await ctx.sql`update proofs set status = 'escalated', verifier_notes = ${reason} where id = ${proof_id}`;
    await ctx.transition(job_id, "escalated");
    return { job_id, status: "escalated" as const };
  },

  // ---- Cameron: payments ----
  async capture_payment({ job_id }, ctx) {
    const [j] = await ctx.sql`select status, budget_usd from jobs where id = ${job_id}`;
    if (j?.status !== "approved") throw new Error(`job is ${j?.status}; capture only after approval`);
    const done = await ctx.sql`select 1 from ledger where job_id = ${job_id} and kind = 'capture'`;
    if (!done.length) await ctx.ledger(job_id, "capture", Number(j.budget_usd), "mock");
    return { job_id, captured_usd: Number(j.budget_usd) };
  },

  async payout({ job_id }, ctx) {
    const [j] = await ctx.sql`select status, worker_id, worker_pay_usd, fee_usd from jobs where id = ${job_id}`;
    if (j?.status !== "approved") throw new Error(`job is ${j?.status}; payout only after approval`);
    const captured = await ctx.sql`select 1 from ledger where job_id = ${job_id} and kind = 'capture'`;
    if (!captured.length) throw new Error("capture_payment first");
    if (Number(j.worker_pay_usd) > PAYOUT_MAX) return { error: "over_limit" as const };
    await ctx.ledger(job_id, "payout", Number(j.worker_pay_usd), "mock");
    await ctx.ledger(job_id, "fee", Number(j.fee_usd), "mock");
    await ctx.sql`update workers set jobs_done = jobs_done + 1 where id = ${j.worker_id}`;
    await ctx.transition(job_id, "paid");
    return { job_id, status: "paid" as const, worker_pay_usd: Number(j.worker_pay_usd), fee_usd: Number(j.fee_usd) };
  },

  async refund({ job_id, reason }, ctx) {
    const [j] = await ctx.sql`select budget_usd from jobs where id = ${job_id}`;
    await ctx.transition(job_id, "refunded");
    await ctx.ledger(job_id, "refund", Number(j.budget_usd), `mock: ${reason}`.slice(0, 200));
    return { job_id, status: "refunded" as const, amount_usd: Number(j.budget_usd) };
  },

  async ledger({ since }, ctx) {
    const s = since ? new Date(since) : new Date(0);
    const rows = await ctx.sql`select kind, coalesce(sum(amount_usd),0)::float as total from ledger where created_at >= ${s} group by kind`;
    const t = Object.fromEntries(rows.map((r: any) => [r.kind, r.total]));
    const [{ n }] = await ctx.sql`select count(*)::int as n from jobs where status = 'paid' and updated_at >= ${s}`;
    const costs = (t.stripe_cost ?? 0) + (t.sms_cost ?? 0) + (t.scrape_cost ?? 0);
    return { revenue_usd: t.capture ?? 0, payouts_usd: t.payout ?? 0, fees_usd: t.fee ?? 0, costs_usd: costs, jobs_paid: n };
  },

  // public tools are implemented in edwin.ts, not mocked
  request_human: null as any,
  get_job: null as any,
  cancel_job: null as any,
};
