import { pickChannel } from './channel.js';
import { dedupeKey, identityKeys, mergeLeads } from './dedupe.js';
import { personEnrichers } from './enrich/index.js';
import type { Env } from './env.js';
import { distanceKm } from './geo.js';
import type { Monid } from './monid.js';
import { mergeProfiles } from './profiles.js';
import { planSearch, type SearchPlan } from './queries.js';
import type { Repo } from './repo.js';
import { distanceToJob, fitScore, locationMatches, scorePerson, type ScoreContext, type Scorable } from './score.js';
import { crawl } from './sources/crawl.js';
import { googleMaps } from './sources/googleMaps.js';
import { hunter } from './sources/hunter.js';
import { mapsNearby } from './sources/mapsNearby.js';
import { peopleSources } from './sources/people/index.js';
import { SourceError, type Enricher, type SourceAdapter, type SourceContext } from './sources/types.js';
import type { Candidate, FindPeopleInput, FindPeopleOutput, JobForOutreach, Lead, Person, SourceRun } from './types.js';

export interface FindDeps {
  repo: Repo;
  monid: Monid;
  env: Env;
  /** Test overrides: people-search sources and person enrichers. */
  sources?: SourceAdapter[];
  enrichers?: Enricher[];
}

export interface FindDetailed {
  output: FindPeopleOutput;
  runs: SourceRun[];
  spend_usd: number;
  plan: SearchPlan;
}

/** Below this, a candidate is a poor fit (e.g. an unrelated Reddit poster); never invited. */
export const MIN_SCORE = 0.3;
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 50;
const MAX_ENRICH = 60;
const ENRICH_CONCURRENCY = 6;
/** Naive truncates tool results at 8,000 chars; stay under. */
const MAX_OUTPUT_CHARS = 7500;
const MAX_REGULARS_SCAN = 300;

/** Short, stable names for the `source` field. */
export function shortSource(id: string | null): string {
  if (!id) return 'unknown';
  const s = id.toLowerCase();
  if (s.includes('search_nearby')) return 'maps_nearby';
  if (s.includes('maps')) return 'google_maps';
  if (s.includes('linkedin')) return 'linkedin';
  if (/(twitter|(^|[:/._-])x([:/._-]|$))/.test(s)) return 'x';
  if (s.includes('reddit')) return 'reddit';
  if (/google.*(profile|serp|search)|profile.*google/.test(s)) return 'google_profiles';
  if (s.includes('people')) return 'people_search';
  return s.replace(/^monid:/, '').slice(0, 24);
}

function err(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function leadAsScorable(l: Lead): Scorable {
  return {
    name: l.name,
    lat: l.lat,
    lng: l.lng,
    categories: l.categories,
    snippet: l.snippet,
    rating: l.rating,
    regular: false,
    email: l.email,
    phone: l.phone,
    sms_consent: false,
    opted_out: false,
    kind: l.kind,
    headline: l.headline ?? null,
    location_text: l.location_text ?? null,
    credentials: l.credentials ?? [],
    open_to_work: l.open_to_work ?? false,
    last_active_at: l.last_active_at ?? null,
    profiles: l.profiles ?? [],
  };
}

const REMOTE_CAPABLE = /\b(remote|worldwide|anywhere|online|virtual|global)\b/i;

/** On-site: should a lead without coordinates stay? Persons only if they say they are in the job's area (or work remotely). */
function keepWithoutCoords(l: Lead, plan: SearchPlan): boolean {
  if (l.kind === 'business') return true;
  if (locationMatches(l.location_text ?? l.address, plan.locationText)) return true;
  return REMOTE_CAPABLE.test(`${l.location_text ?? ''} ${l.headline ?? ''} ${l.snippet ?? ''}`);
}

export async function findPeopleDetailed(input: FindPeopleInput, deps: FindDeps): Promise<FindDetailed> {
  const { repo, monid, env } = deps;
  const sources = deps.sources ?? peopleSources;
  const enrichers = [...(deps.enrichers ?? personEnrichers)].sort((a, b) => a.costEstimateUsd - b.costEstimateUsd);
  const job: JobForOutreach | null = await repo.getJob(input.job_id);
  if (!job) throw new Error(`find_people: job ${input.job_id} not found`);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(input.limit ?? DEFAULT_LIMIT)));
  const radiusKm = env.OUTREACH_RADIUS_KM;
  const max = env.OUTREACH_MAX_SPEND_USD;

  const plan = planSearch(job, input.hints);
  const remote = plan.remote;
  const onsiteCoords = !remote && job.lat !== null && job.lng !== null;
  const hints = { roles: plan.roles, skills: plan.skills, credential: plan.credential };
  const scoreCtx: ScoreContext = {
    radiusKm,
    queries: plan.mapsQueries,
    roles: plan.roles,
    skills: plan.skills,
    credential: plan.credential,
    remote,
    locationText: plan.locationText,
  };
  // People queries: the roles; for on-site jobs, scoped to the job's city.
  const peopleQueries = plan.roles.map((r) => (remote || !plan.locationText ? r : `${r} ${plan.locationText}`));

  const runMap = new Map<string, SourceRun>();
  let spend = 0;
  let reserved = 0;
  const record = (source: string, leads: number, cost: number, error?: string) => {
    const r = runMap.get(source) ?? { source, leads: 0, cost_usd: 0 };
    r.leads += leads;
    r.cost_usd += cost;
    if (error) r.error = r.error ? `${r.error}; ${error}` : error;
    runMap.set(source, r);
    spend += cost;
  };

  /** Reserve worst-case cost for a search (trimming per-query adapters to the budget). Null when unaffordable. */
  const reserve = (adapter: SourceAdapter, queries: string[]): { qs: string[]; held: number } | null => {
    const room = max - spend - reserved;
    let qs = queries;
    let held = adapter.costEstimateUsd;
    if (adapter.perQuery) {
      const n = Math.min(qs.length, Math.floor(room / adapter.costEstimateUsd + 1e-9));
      qs = qs.slice(0, Math.max(0, n));
      held = qs.length * adapter.costEstimateUsd;
      if (qs.length === 0) {
        record(adapter.id, 0, 0, 'skipped: budget');
        return null;
      }
    } else if (adapter.costEstimateUsd > room + 1e-9) {
      record(adapter.id, 0, 0, 'skipped: budget');
      return null;
    }
    reserved += held;
    return { qs, held };
  };

  const runReserved = async (adapter: SourceAdapter, r: { qs: string[]; held: number }): Promise<Lead[] | null> => {
    const ctx: SourceContext = { job, monid, radiusKm, queries: r.qs, hints, remote };
    try {
      const res = await adapter.run(ctx);
      reserved -= r.held;
      record(adapter.id, res.leads.length, res.cost_usd);
      return res.leads;
    } catch (e) {
      reserved -= r.held;
      record(adapter.id, 0, e instanceof SourceError ? e.cost_usd : 0, err(e));
      return null;
    }
  };

  const search = async (adapter: SourceAdapter, queries: string[]): Promise<Lead[] | null> => {
    const r = reserve(adapter, queries);
    return r ? runReserved(adapter, r) : null;
  };

  // 1. regulars first (on-site: near the job; remote: any regular whose profile fits the roles)
  let regulars: Person[];
  if (onsiteCoords) {
    regulars = await repo.listRegularsNear(job.lat!, job.lng!, radiusKm, limit);
  } else {
    const all = await repo.listRegularsNear(0, 0, 20100, MAX_REGULARS_SCAN).catch(() => [] as Person[]);
    regulars = all.filter((p) => fitScore(p, scoreCtx) >= 0.5).slice(0, limit);
  }

  // 2. search: people sources for every job (in parallel, budget reserved up front); Maps businesses only as on-site backup
  const planned = sources.map((s) => ({ s, r: reserve(s, peopleQueries) }));
  const peopleRuns = planned.filter((x) => x.r).map((x) => runReserved(x.s, x.r!));
  const mapsRun = (async () => {
    if (remote) return [] as Lead[];
    let l = (await search(googleMaps, plan.mapsQueries)) ?? [];
    if (l.length === 0) l = (await search(mapsNearby, plan.mapsQueries)) ?? [];
    return l;
  })();
  const [peopleLeads, mapsLeads] = await Promise.all([Promise.all(peopleRuns), mapsRun]);
  let leads: Lead[] = [...peopleLeads.flatMap((l) => l ?? []), ...mapsLeads];

  // 3. merge across sources + area filter
  leads = mergeLeads(leads);
  if (onsiteCoords) {
    leads = leads.filter((l) =>
      l.lat !== null && l.lng !== null ? distanceKm(job.lat!, job.lng!, l.lat, l.lng) <= radiusKm : keepWithoutCoords(l, plan),
    );
  }
  // Key before enrichment: stable across runs and matches earlier saves (and opt-outs) even once an email is found.
  const keys = new Map<Lead, string>(leads.map((l) => [l, dedupeKey(l)]));
  // Reuse contacts we already know: no paid enrichment for someone saved with an email (or opted out).
  const allKeys = [...new Set(leads.flatMap((l) => [keys.get(l)!, ...identityKeys(l)]))];
  const known = new Map((await repo.getByDedupeKeys(allKeys)).map((p) => [p.dedupe_key, p]));
  const knownFor = (l: Lead): Person | undefined => [keys.get(l)!, ...identityKeys(l)].map((k) => known.get(k)).find(Boolean);
  for (const l of leads) {
    const k = knownFor(l);
    if (k?.email && !l.email) l.email = k.email;
  }

  // 4. enrich the top candidates (up to MAX_ENRICH, skipping anyone who already has an email), cheapest step first, stopping at the first email
  const stepsFor = (l: Lead): Enricher[] => {
    if (l.kind === 'person') return enrichers.filter((e) => !e.applies || e.applies(l));
    return l.website ? [crawl, hunter] : [];
  };
  const targets = leads
    .filter((l) => !l.email && knownFor(l)?.opted_out !== true && stepsFor(l).length > 0)
    .map((l) => ({ l, s: scorePerson(leadAsScorable(l), job, scoreCtx) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_ENRICH)
    .map((t) => t.l);

  const enrichOne = async (lead: Lead) => {
    for (const step of stepsFor(lead)) {
      if (lead.email) break;
      if (spend + reserved + step.costEstimateUsd > max + 1e-9) {
        record(step.id, 0, 0, 'skipped: budget');
        continue;
      }
      reserved += step.costEstimateUsd;
      try {
        const r = await step.enrich(lead, monid);
        record(step.id, r.email ? 1 : 0, r.cost_usd);
        if (r.email) lead.email = r.email;
        if (r.phone && !lead.phone) lead.phone = r.phone;
        if (r.profiles?.length) lead.profiles = mergeProfiles(lead.profiles, r.profiles);
        // Person enrichers (src/enrich) may also return profile details; keep the first non-empty value.
        const extra = r as { open_to_work?: boolean; headline?: string | null; location_text?: string | null };
        if (extra.open_to_work) lead.open_to_work = true;
        if (extra.headline && !lead.headline) lead.headline = extra.headline;
        if (extra.location_text && !lead.location_text) lead.location_text = extra.location_text;
      } catch (e) {
        record(step.id, 0, e instanceof SourceError ? e.cost_usd : 0, err(e));
      } finally {
        reserved -= step.costEstimateUsd;
      }
    }
  };
  // worker pool: ENRICH_CONCURRENCY leads in flight, best-scored first
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(ENRICH_CONCURRENCY, targets.length) }, async () => {
      while (next < targets.length) await enrichOne(targets[next++]!);
    }),
  );

  // 5. persist
  const people = new Map<string, Person>();
  const leadOf = new Map<string, Lead>();
  for (const p of regulars) people.set(p.id, p);
  for (const lead of leads) {
    const p = await repo.upsertLead(lead, keys.get(lead)!);
    leadOf.set(p.id, lead);
    if (!people.has(p.id) || p.regular) people.set(p.id, p);
  }

  // 6. rank: regulars first, then score. Fields fall back to the in-memory lead if the repo didn't store them.
  const view = (p: Person): Person => {
    const l = leadOf.get(p.id);
    if (!l) return p;
    return {
      ...p,
      profiles: mergeProfiles(p.profiles, l.profiles),
      headline: p.headline ?? l.headline ?? null,
      location_text: p.location_text ?? l.location_text ?? null,
      credentials: p.credentials?.length ? p.credentials : (l.credentials ?? []),
      open_to_work: p.open_to_work || (l.open_to_work ?? false),
      last_active_at: p.last_active_at ?? l.last_active_at ?? null,
    };
  };
  const ranked = [...people.values()]
    .map(view)
    .map((p) => ({ p, channel: pickChannel(p, { allowManual: env.OUTREACH_MANUAL_QUEUE }), score: scorePerson(p, job, scoreCtx), d: remote ? null : distanceToJob(p, job) }))
    .filter((x): x is typeof x & { channel: NonNullable<typeof x.channel> } => x.channel !== null)
    .filter((x) => x.d === null || x.d <= radiusKm) // on-site: never invite people outside the job's area
    .filter((x) => x.p.regular || x.score >= MIN_SCORE) // don't invite clearly irrelevant people
    .sort((a, b) => Number(b.p.regular) - Number(a.p.regular) || b.score - a.score || (a.d ?? 1e9) - (b.d ?? 1e9))
    .slice(0, limit);

  let candidates: Candidate[] = ranked.map((x) => ({
    candidate_id: x.p.id,
    name: x.p.name ? x.p.name.slice(0, 32) : null,
    channel: x.channel,
    source: x.p.regular ? 'regular' : shortSource(x.p.source),
    distance_km: x.d === null ? null : Math.round(x.d * 10) / 10,
    score: Math.round(x.score * 100) / 100,
  }));
  while (candidates.length > 1 && JSON.stringify({ candidates }).length > MAX_OUTPUT_CHARS) {
    candidates = candidates.slice(0, -1);
  }

  const runs = [...runMap.values()].map((r) => ({ ...r, cost_usd: Math.round(r.cost_usd * 1e6) / 1e6 }));
  const spend_usd = Math.round(spend * 1e6) / 1e6;
  if (spend_usd > 0) await repo.recordCost(job.id, 'scrape_cost', spend_usd, 'find_people');
  return { output: { candidates }, runs, spend_usd, plan };
}

export async function findPeople(input: FindPeopleInput, deps: FindDeps): Promise<FindPeopleOutput> {
  return (await findPeopleDetailed(input, deps)).output;
}
