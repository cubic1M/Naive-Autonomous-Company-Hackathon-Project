import { describe, expect, it } from 'vitest';
import { findPeopleDetailed } from '../src/find.js';
import { InMemoryRepo } from '../src/repo/memory.js';
import type { Enricher, SourceAdapter } from '../src/sources/types.js';
import type { Lead } from '../src/types.js';
import { FakeMonid, makeEnv, makeJob } from './helpers/fakeMonid.js';

const never = () => new Promise<never>(() => {});
const remoteJob = { title: 'Review our SaaS terms of service', instructions: 'Online contract review', remote: true, lat: null, lng: null };

function pool() {
  const repo = new InMemoryRepo();
  repo.addJob(makeJob(remoteJob));
  return repo;
}
const attorney = (i: number, o: Record<string, unknown> = {}) => ({
  dedupe_key: `email:a${i}@law.example`, name: `Pool Lawyer ${i}`, email: `a${i}@law.example`, headline: 'Freelance contract attorney',
  location_text: 'Austin', credentials: ['California Bar'], ...o,
});
const lead = (o: Partial<Lead> = {}): Lead => ({
  name: 'Live Lena', kind: 'person', email: null, phone: null, website: null, profile_url: null, address: null, lat: null, lng: null,
  source: 'monid:x/linkedin', source_ref: null, categories: [], rating: null, snippet: 'contract attorney', headline: 'Contract attorney', ...o,
});
const src = (run: SourceAdapter['run']): SourceAdapter => ({ id: 'fake', costEstimateUsd: 0.001, perQuery: false, run });

describe('time budget', () => {
  it('stops waiting on a source that never resolves and returns what it has', async () => {
    const repo = pool();
    repo.addPerson(attorney(1));
    const env = makeEnv({ OUTREACH_TIME_BUDGET_MS: 300, OUTREACH_MANUAL_QUEUE: false });
    const t = Date.now();
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid: new FakeMonid(), env, sources: [src(never)], enrichers: [] });
    expect(Date.now() - t).toBeLessThan(1500);
    expect(res.elapsed_ms).toBeLessThan(1500);
    expect(res.output.candidates.map((c) => c.name)).toEqual(['Pool Lawyer 1']);
    expect(res.spend_usd).toBeGreaterThan(0); // the abandoned source's estimate counts
  });

  it('starts enrichment at 60% of the budget even if a source is still running, and stops at the deadline', async () => {
    const repo = pool();
    const env = makeEnv({ OUTREACH_TIME_BUDGET_MS: 500, OUTREACH_MANUAL_QUEUE: false });
    const quick = src(async () => ({ leads: [lead({ name: 'Quick Quinn' })], cost_usd: 0 }));
    const hang = { ...src(never), id: 'hang' };
    let launched = 0;
    const enr: Enricher = { id: 'enr', costEstimateUsd: 0.001, enrich: async () => (launched++, never()) };
    const t = Date.now();
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid: new FakeMonid(), env, sources: [quick, hang], enrichers: [enr] });
    expect(Date.now() - t).toBeLessThan(1500);
    expect(launched).toBe(1);
    expect(res.output.candidates).toHaveLength(0); // never got an email
  });

  it('times out an individual Monid call and counts the estimate as cost', async () => {
    const repo = pool();
    const env = makeEnv({ OUTREACH_TIME_BUDGET_MS: 5000, OUTREACH_CALL_TIMEOUT_MS: 50, OUTREACH_MANUAL_QUEUE: false });
    const monid = { run: () => never() } as unknown as FakeMonid;
    const enr: Enricher = { id: 'enr', costEstimateUsd: 0.002, enrich: async (_l, m) => (await m.run('p', '/e', {}), { email: 'x@y.example', phone: null, cost_usd: 0 }) };
    const t = Date.now();
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env, sources: [src(async () => ({ leads: [lead()], cost_usd: 0 }))], enrichers: [enr] });
    expect(Date.now() - t).toBeLessThan(1500);
    const run = res.runs.find((r) => r.source === 'enr')!;
    expect(run.error).toMatch(/timed out/);
    expect(run.cost_usd).toBeCloseTo(0.002);
  });

  it('honors OUTREACH_ENRICH_CONCURRENCY', async () => {
    const repo = pool();
    const env = makeEnv({ OUTREACH_ENRICH_CONCURRENCY: 3, OUTREACH_MANUAL_QUEUE: false, OUTREACH_MAX_SPEND_USD: 1 });
    let cur = 0, peak = 0;
    const enr: Enricher = {
      id: 'enr', costEstimateUsd: 0.001,
      enrich: async () => { peak = Math.max(peak, ++cur); await new Promise((r) => setTimeout(r, 10)); cur--; return { email: null, phone: null, cost_usd: 0 }; },
    };
    const leads = Array.from({ length: 12 }, (_, i) => lead({ name: `Person ${i}`, profile_url: `https://l.example/${i}` }));
    await findPeopleDetailed({ job_id: 'job1' }, { repo, monid: new FakeMonid(), env, sources: [src(async () => ({ leads, cost_usd: 0 }))], enrichers: [enr] });
    expect(peak).toBe(3);
  });
});

describe('talent pool', () => {
  it('returns pool people instantly, marked source pool, with no source calls when the pool fills the limit', async () => {
    const repo = pool();
    for (let i = 0; i < 6; i++) repo.addPerson(attorney(i));
    repo.addPerson(attorney(99, { name: 'Opted Out', opted_out: true }));
    repo.addPerson({ dedupe_key: 'x', name: 'No Email', headline: 'contract attorney' });
    let called = 0;
    const env = makeEnv({ OUTREACH_MANUAL_QUEUE: false });
    const res = await findPeopleDetailed({ job_id: 'job1', limit: 5 }, { repo, monid: new FakeMonid(), env, sources: [src(async () => (called++, { leads: [], cost_usd: 0 }))], enrichers: [] });
    expect(called).toBe(0);
    expect(res.output.candidates).toHaveLength(5);
    expect(res.output.candidates.every((c) => c.source === 'pool' && c.channel === 'email')).toBe(true);
    expect(res.from_pool).toBe(5);
    expect(res.spend_usd).toBe(0);
    expect(res.elapsed_ms).toBeLessThan(500);
  });

  it('adds pool people and live results together, skipping enrichment for the pool', async () => {
    const repo = pool();
    repo.addPerson(attorney(1));
    const enriched: string[] = [];
    const enr: Enricher = { id: 'enr', costEstimateUsd: 0.001, enrich: async (l) => (enriched.push(l.name!), { email: 'lena@law.example', phone: null, cost_usd: 0.001 }) };
    const res = await findPeopleDetailed({ job_id: 'job1' }, {
      repo, monid: new FakeMonid(), env: makeEnv({ OUTREACH_MANUAL_QUEUE: false }),
      sources: [src(async () => ({ leads: [lead()], cost_usd: 0 }))], enrichers: [enr],
    });
    expect(enriched).toEqual(['Live Lena']);
    const bySource = Object.fromEntries(res.output.candidates.map((c) => [c.name, c.source]));
    expect(bySource['Pool Lawyer 1']).toBe('pool');
    expect(bySource['Live Lena']).not.toBe('pool');
    expect(res.from_pool).toBe(1);
  });

  it('pool hits must still clear MIN_SCORE', async () => {
    const repo = pool();
    repo.addPerson({ dedupe_key: 'e:z', name: 'Zed', email: 'z@x.example', snippet: 'I like attorney shows on TV' });
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid: new FakeMonid(), env: makeEnv({ OUTREACH_MANUAL_QUEUE: false }), sources: [], enrichers: [] });
    expect(res.output.candidates.map((c) => c.name)).not.toContain('Zed');
  });
});

describe('InMemoryRepo.searchPool', () => {
  const sf = { lat: 37.7749, lng: -122.4194 };
  it('matches any term case-insensitively, orders by hits, open_to_work, recency; skips uncontactable', async () => {
    const r = new InMemoryRepo();
    r.addPerson({ dedupe_key: '1', name: 'One', email: 'one@x.example', headline: 'React developer' });
    r.addPerson({ dedupe_key: '2', name: 'Two', email: 'two@x.example', headline: 'React TypeScript developer' });
    r.addPerson({ dedupe_key: '3', name: 'Three', email: 'three@x.example', headline: 'React developer', open_to_work: true });
    r.addPerson({ dedupe_key: '4', name: 'Four', email: 'four@x.example', snippet: 'REACT', last_active_at: '2026-01-01T00:00:00Z' });
    r.addPerson({ dedupe_key: '5', name: 'Five', email: 'five@x.example', categories: ['react'], last_active_at: '2026-06-01T00:00:00Z' });
    r.addPerson({ dedupe_key: '6', name: 'Six', headline: 'react' }); // no contact
    r.addPerson({ dedupe_key: '7', name: 'Seven', email: 's@x.example', headline: 'react', opted_out: true });
    r.addPerson({ dedupe_key: '8', name: 'Eight', email: 'e@x.example', headline: 'plumber' });
    r.addPerson({ dedupe_key: '9', name: 'Nine', phone: '4155550101', regular: true, sms_consent: true, headline: 'react' });
    const names = (await r.searchPool({ terms: ['React', 'typescript'], remote: true, limit: 50 })).map((p) => p.name);
    expect(names).toEqual(['Two', 'Three', 'Five', 'Four', 'One', 'Nine']);
    expect(await r.searchPool({ terms: ['react'], remote: true, limit: 2 })).toHaveLength(2);
    expect(await r.searchPool({ terms: [], remote: true, limit: 5 })).toEqual([]);
  });

  it('on-site: radius when coordinates exist, else city mention', async () => {
    const r = new InMemoryRepo();
    r.addPerson({ dedupe_key: 'a', name: 'Near', email: 'a@x.example', headline: 'notary', lat: 37.78, lng: -122.41 });
    r.addPerson({ dedupe_key: 'b', name: 'Far', email: 'b@x.example', headline: 'notary', lat: 34.05, lng: -118.24 });
    r.addPerson({ dedupe_key: 'c', name: 'CityText', email: 'c@x.example', headline: 'notary', location_text: 'San Francisco Bay Area' });
    r.addPerson({ dedupe_key: 'd', name: 'Elsewhere', email: 'd@x.example', headline: 'notary', location_text: 'Austin, TX' });
    const names = (await r.searchPool({ terms: ['notary'], remote: false, ...sf, radiusKm: 10, locationText: 'San Francisco', limit: 10 })).map((p) => p.name).sort();
    expect(names).toEqual(['CityText', 'Near']);
  });

  it('snapshot round-trips people only', async () => {
    const r = new InMemoryRepo();
    r.addJob(makeJob());
    const p = r.addPerson({ dedupe_key: 'a', name: 'Ann', email: 'ann@x.example', headline: 'notary', profiles: [{ platform: 'linkedin', url: 'https://linkedin.com/in/ann', handle: 'ann' }], last_contacted_at: '2026-01-01T00:00:00Z' });
    await r.recordCost('job1', 'scrape_cost', 1, 'x');
    const snap = JSON.parse(JSON.stringify(r.toSnapshot()));
    expect(Object.keys(snap).sort()).toEqual(['people', 'version']);
    const r2 = InMemoryRepo.fromSnapshot(snap);
    expect(r2.jobs.size).toBe(0);
    expect(r2.costs).toHaveLength(0);
    expect(r2.outreach).toHaveLength(0);
    expect(r2.people.size).toBe(1);
    expect(r2.people.get(p.id)).toMatchObject({ name: 'Ann', email: 'ann@x.example', dedupe_key: 'a', last_contacted_at: null });
    expect(r2.people.get(p.id)!.profiles).toHaveLength(1);
    expect(InMemoryRepo.fromSnapshot({}).people.size).toBe(0);
  });
});
