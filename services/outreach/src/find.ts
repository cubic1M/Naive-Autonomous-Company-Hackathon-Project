import { pickChannel } from './channel.js';
import { dedupeKey, mergeLeads } from './dedupe.js';
import type { Env } from './env.js';
import { distanceKm } from './geo.js';
import type { Monid } from './monid.js';
import { planQueries } from './queries.js';
import type { Repo } from './repo.js';
import { distanceToJob, scorePerson, type Scorable } from './score.js';
import { crawl } from './sources/crawl.js';
import { googleMaps } from './sources/googleMaps.js';
import { hunter } from './sources/hunter.js';
import { linkedin } from './sources/linkedin.js';
import { mapsNearby } from './sources/mapsNearby.js';
import { SourceError, type SourceAdapter } from './sources/types.js';
import type { Candidate, FindPeopleInput, FindPeopleOutput, JobForOutreach, Lead, Person, SourceRun } from './types.js';

export interface FindDeps {
  repo: Repo;
  monid: Monid;
  env: Env;
}

export interface FindDetailed {
  output: FindPeopleOutput;
  runs: SourceRun[];
  spend_usd: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_ENRICH = 12;
const ENRICH_CONCURRENCY = 4;
/** Naïve truncates tool results at 8,000 chars; stay under. */
const MAX_OUTPUT_CHARS = 7500;

const SHORT_SOURCE: Record<string, string> = {
  'monid:litescrape/google/maps': 'google_maps',
  'monid:anyapi/maps.search_nearby': 'maps_nearby',
  'monid:ploid/linkedin/search': 'linkedin',
};

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
  };
}

export async function findPeopleDetailed(input: FindPeopleInput, deps: FindDeps): Promise<FindDetailed> {
  const { repo, monid, env } = deps;
  const job: JobForOutreach | null = await repo.getJob(input.job_id);
  if (!job) throw new Error(`find_people: job ${input.job_id} not found`);
  if (job.lat === null || job.lng === null) throw new Error(`find_people: job ${input.job_id} has no lat/lng`);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(input.limit ?? DEFAULT_LIMIT)));
  const radiusKm = env.OUTREACH_RADIUS_KM;
  const max = env.OUTREACH_MAX_SPEND_USD;
  const queries = planQueries(job);

  const runMap = new Map<string, SourceRun>();
  let spend = 0;
  const record = (source: string, leads: number, cost: number, error?: string) => {
    const r = runMap.get(source) ?? { source, leads: 0, cost_usd: 0 };
    r.leads += leads;
    r.cost_usd += cost;
    if (error) r.error = r.error ? `${r.error}; ${error}` : error;
    runMap.set(source, r);
    spend += cost;
  };
  const affordable = (est: number) => spend + est <= max + 1e-9;

  /** Run a search adapter within budget. Returns leads, or null on failure / no budget. */
  const search = async (adapter: SourceAdapter): Promise<Lead[] | null> => {
    let qs = queries;
    if (adapter.perQuery) {
      const n = Math.min(qs.length, Math.floor((max - spend) / adapter.costEstimateUsd + 1e-9));
      qs = qs.slice(0, Math.max(0, n));
      if (qs.length === 0) {
        record(adapter.id, 0, 0, 'skipped: budget');
        return null;
      }
    } else if (!affordable(adapter.costEstimateUsd)) {
      record(adapter.id, 0, 0, 'skipped: budget');
      return null;
    }
    try {
      const r = await adapter.run({ job, monid, radiusKm, queries: qs });
      record(adapter.id, r.leads.length, r.cost_usd);
      return r.leads;
    } catch (e) {
      record(adapter.id, 0, e instanceof SourceError ? e.cost_usd : 0, err(e));
      return null;
    }
  };

  // 1. regulars first
  const regulars = await repo.listRegularsNear(job.lat, job.lng, radiusKm, limit);

  // 2. search
  let leads = (await search(googleMaps)) ?? [];
  if (leads.length === 0) leads = (await search(mapsNearby)) ?? [];
  if (job.certification_required) leads.push(...((await search(linkedin)) ?? []));

  // 3. dedupe + enrich
  leads = mergeLeads(leads);
  // Maps returns some far-away "relevant" places; drop them before paying to enrich them.
  leads = leads.filter((l) => l.lat === null || l.lng === null || distanceKm(job.lat!, job.lng!, l.lat, l.lng) <= radiusKm);
  // Key before enrichment: stable across runs and matches earlier saves (and opt-outs) even once an email is found.
  const keys = new Map<Lead, string>(leads.map((l) => [l, dedupeKey(l)]));
  const ctx = { radiusKm, queries };
  // Reuse contacts we already know: no paid enrichment for someone saved with an email (or opted out).
  const known = new Map((await repo.getByDedupeKeys([...keys.values()])).map((p) => [p.dedupe_key, p]));
  for (const l of leads) {
    const k = known.get(keys.get(l)!);
    if (k?.email && !l.email) l.email = k.email;
  }
  const skipEnrich = (l: Lead) => known.get(keys.get(l)!)?.opted_out === true;
  const targets = leads
    .filter((l) => l.kind === 'business' && !l.email && l.website && !skipEnrich(l))
    .map((l) => ({ l, s: scorePerson(leadAsScorable(l), job, ctx) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_ENRICH)
    .map((t) => t.l);

  // Cheapest first: crawling the site ($0.001) usually finds a contact email; Hunter ($0.0245) is the fallback.
  // Run ENRICH_CONCURRENCY leads at a time, reserving each step's estimate so parallel calls can't overspend.
  let reserved = 0;
  const enrichOne = async (lead: Lead) => {
    for (const step of [crawl, hunter]) {
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
      } catch (e) {
        record(step.id, 0, e instanceof SourceError ? e.cost_usd : 0, err(e));
      } finally {
        reserved -= step.costEstimateUsd;
      }
    }
  };
  for (let i = 0; i < targets.length; i += ENRICH_CONCURRENCY) {
    await Promise.all(targets.slice(i, i + ENRICH_CONCURRENCY).map(enrichOne));
  }

  // 4. persist
  const people = new Map<string, Person>();
  for (const p of regulars) people.set(p.id, p);
  for (const lead of leads) {
    const p = await repo.upsertLead(lead, keys.get(lead)!);
    if (!people.has(p.id)) people.set(p.id, p);
    else if (p.regular) people.set(p.id, p);
  }

  // 5. rank
  const ranked = [...people.values()]
    .map((p) => ({ p, channel: pickChannel(p), score: scorePerson(p, job, ctx), d: distanceToJob(p, job) }))
    .filter((x): x is typeof x & { channel: NonNullable<typeof x.channel> } => x.channel !== null)
    .filter((x) => x.d === null || x.d <= radiusKm) // never invite people outside the job's area
    .sort((a, b) => Number(b.p.regular) - Number(a.p.regular) || b.score - a.score || (a.d ?? 1e9) - (b.d ?? 1e9))
    .slice(0, limit);

  let candidates: Candidate[] = ranked.map((x) => ({
    candidate_id: x.p.id,
    name: x.p.name ? x.p.name.slice(0, 40) : null,
    channel: x.channel,
    source: x.p.regular ? 'regular' : (SHORT_SOURCE[x.p.source ?? ''] ?? x.p.source ?? 'unknown'),
    distance_km: x.d === null ? null : Math.round(x.d * 10) / 10,
    score: Math.round(x.score * 100) / 100,
  }));
  while (candidates.length > 1 && JSON.stringify({ candidates }).length > MAX_OUTPUT_CHARS) {
    candidates = candidates.slice(0, -1);
  }

  const runs = [...runMap.values()].map((r) => ({ ...r, cost_usd: Math.round(r.cost_usd * 1e6) / 1e6 }));
  const spend_usd = Math.round(spend * 1e6) / 1e6;
  if (spend_usd > 0) await repo.recordCost(job.id, 'scrape_cost', spend_usd, 'find_people');
  return { output: { candidates }, runs, spend_usd };
}

export async function findPeople(input: FindPeopleInput, deps: FindDeps): Promise<FindPeopleOutput> {
  return (await findPeopleDetailed(input, deps)).output;
}
