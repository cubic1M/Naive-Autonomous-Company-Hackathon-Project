/** growth_report: one read for Sales, Recruiter and the CEO (spec section 8). */
import type { GrowthDeps } from './deps.js';
import { demandFrom, targetFor, type Demand } from './demand.js';
import { FAMILY_KEYS, type Family } from './families.js';
import { RECENT_DAYS } from './guard.js';
import { promosDue, type PromoDue } from './redeem.js';
import { DAY_MS, pacificDate, pacificDayStart } from './time.js';

export interface DirectoryEntry {
  found: number;
  invited: number;
  opted_in: number;
  /** Opted in and Stripe Identity verified: pre-vetted. */
  id_verified: number;
  /** Holds a verified licence (notary commission; State Bar after the liability PR). */
  licensed: number;
  target: number;
  gap: number;
}

export interface GrowthReport {
  day: string;
  live: { sales: boolean; recruit: boolean };
  sales: { sent_today: number; dry_run_today: number; daily_cap: number; prospects_waiting: number };
  recruiting: { sent_today: number; dry_run_today: number; daily_cap: number; search_spend_today_usd: number; search_cap_usd: number };
  directory: Record<Family, DirectoryEntry>;
  demand: Demand;
  promos: { granted: number; max: number; redeemed: number; due: PromoDue[] };
}

const LICENCES = new Set(['notary_commission', 'attorney_license']);
const round = (n: number) => Math.round(n * 10_000) / 10_000;

export async function growthReport(deps: GrowthDeps): Promise<GrowthReport> {
  const { env, repo } = deps;
  const now = deps.now();
  const day = pacificDayStart(now);
  const [marketing, invites, spend, waiting, recruits, jobs, grants] = await Promise.all([
    repo.messageCountsSince('marketing', day),
    repo.messageCountsSince('invite', day),
    repo.searchSpendSince(day),
    repo.listProspects({ limit: 1000, notSentSince: new Date(now.getTime() - RECENT_DAYS * DAY_MS) }),
    repo.listRecruits(),
    repo.listJobsSince(new Date(now.getTime() - 30 * DAY_MS)),
    repo.listGrants(),
  ]);
  const verifications = await repo.listVerifications(recruits.map((r) => r.worker_id).filter((id): id is string => Boolean(id)));
  const verified = (keep: (kind: string) => boolean) => new Set(verifications.filter((v) => v.status === 'verified' && keep(v.kind)).map((v) => v.worker_id));
  const idOk = verified((k) => k === 'identity');
  const licensed = verified((k) => LICENCES.has(k));
  const demand = demandFrom(jobs, now);

  const directory = Object.fromEntries(
    FAMILY_KEYS.map((f) => {
      const rs = recruits.filter((r) => r.family === f && !r.opted_out);
      const optedIn = rs.filter((r) => r.joined_at);
      const idVerified = optedIn.filter((r) => r.worker_id && idOk.has(r.worker_id)).length;
      const target = targetFor(f, demand.by_family[f]);
      const entry: DirectoryEntry = {
        found: rs.length,
        invited: rs.filter((r) => r.last_contacted_at).length,
        opted_in: optedIn.length,
        id_verified: idVerified,
        licensed: rs.filter((r) => r.worker_id && licensed.has(r.worker_id)).length,
        target,
        gap: Math.max(0, target - idVerified),
      };
      return [f, entry];
    }),
  ) as Record<Family, DirectoryEntry>;

  return {
    day: pacificDate(now),
    live: {
      sales: env.GROWTH_LIVE.includes('sales') && env.GROWTH_POSTAL_ADDRESS !== null,
      recruit: env.GROWTH_LIVE.includes('recruit') && env.GROWTH_POSTAL_ADDRESS !== null,
    },
    sales: { sent_today: marketing.sent, dry_run_today: marketing.dry_run, daily_cap: env.GROWTH_SALES_DAILY_CAP, prospects_waiting: waiting.length },
    recruiting: {
      sent_today: invites.sent,
      dry_run_today: invites.dry_run,
      daily_cap: env.GROWTH_RECRUIT_DAILY_CAP,
      search_spend_today_usd: round(spend),
      search_cap_usd: env.GROWTH_SEARCH_DAILY_USD,
    },
    directory,
    demand,
    promos: { granted: grants.length, max: env.GROWTH_PROMO_MAX_GRANTS, redeemed: grants.filter((g) => g.redeemed_job_id).length, due: await promosDue(deps) },
  };
}
