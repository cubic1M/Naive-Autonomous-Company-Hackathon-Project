import { describe, expect, it } from 'vitest';
import { findPeople, findPeopleDetailed } from '../src/find.js';
import { InMemoryRepo } from '../src/repo/memory.js';
import type { Enricher, SourceAdapter } from '../src/sources/types.js';
import type { Lead } from '../src/types.js';
import { FakeMonid, makeEnv, makeJob } from './helpers/fakeMonid.js';

function setup(jobOver = {}, envOver = {}) {
  const repo = new InMemoryRepo();
  repo.addJob(makeJob(jobOver));
  const monid = new FakeMonid();
  // sources/enrichers: [] keeps the Maps-only tests free of the real people sources (rest-spread as `...none`)
  return { repo, monid, env: makeEnv(envOver), sources: [] as SourceAdapter[], enrichers: [] as Enricher[] };
}

const publishedEmail = (e: string) => ({ output: { data: { emails: [{ value: e, type: 'generic', confidence: 90, sources: [{}] }] } } });

describe('findPeople', () => {
  it('throws clearly for a missing job; a job without coordinates is treated as remote', async () => {
    const { repo, monid, env, ...none } = setup({ lat: null, lng: null });
    await expect(findPeople({ job_id: 'nope' }, { repo, monid, env, ...none })).rejects.toThrow(/not found/);
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env, ...none });
    expect(res.plan.remote).toBe(true);
    expect(monid.calls).toHaveLength(0); // no Maps for remote jobs
  });

  it('finds businesses, enriches with email, ranks, saves, records cost', async () => {
    const { repo, monid, env, ...none } = setup();
    monid.override('hunterio/domain-search', publishedEmail('info@kineticevents.com'));
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env, ...none });
    const c = res.output.candidates;
    expect(c.length).toBeGreaterThan(0);
    expect(c.every((x) => x.channel === 'email')).toBe(true);
    expect(c[0]!.name).toBeTruthy();
    expect(c[0]!.distance_km).toBe(Math.round(c[0]!.distance_km! * 10) / 10);
    expect(c.map((x) => x.score)).toEqual([...c.map((x) => x.score)].sort((a, b) => b - a));
    expect(repo.people.size).toBeGreaterThan(c.length); // phone-only businesses saved but not returned
    expect(res.runs.find((r) => r.source === 'monid:litescrape/google/maps')!.leads).toBe(20);
    expect(res.spend_usd).toBeGreaterThan(0);
    expect(repo.costs).toHaveLength(1);
    expect(repo.costs[0]).toMatchObject({ kind: 'scrape_cost', ref: 'find_people' });
  });

  it('crawls first and skips hunter when the site shows an email; caps enrichment at 12', async () => {
    const { repo, monid, env, ...none } = setup();
    monid.override('search1api/crawl', { output: { results: { content: 'write info@acme.com' } } });
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env, ...none });
    const crawls = monid.callsTo('search1api/crawl');
    expect(crawls).toBeGreaterThan(0);
    expect(crawls).toBeLessThanOrEqual(12);
    expect(monid.callsTo('hunterio/domain-search')).toBe(0);
    expect(res.output.candidates.length).toBeGreaterThan(0);
  });

  it('falls back to hunter when the crawl finds no email', async () => {
    const { repo, monid, env, ...none } = setup();
    monid.override('search1api/crawl', { output: { results: { content: 'no contact here' } } });
    monid.override('hunterio/domain-search', publishedEmail('info@x.com'));
    await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env, ...none });
    // 3 pages (home, /contact, /contact-us) per lead before hunter
    expect(monid.callsTo('search1api/crawl')).toBe(3 * monid.callsTo('hunterio/domain-search'));
    expect(monid.callsTo('hunterio/domain-search')).toBeGreaterThan(0);
  });

  it('budget cap stops paid calls', async () => {
    const { repo, monid, env, ...none } = setup({}, { OUTREACH_MAX_SPEND_USD: 0.0002 });
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env, ...none });
    expect(monid.callsTo('litescrape/google/maps')).toBe(1);
    expect(monid.callsTo('hunterio/domain-search')).toBe(0);
    expect(res.spend_usd).toBeLessThanOrEqual(0.0002);
    expect(res.runs.some((r) => r.error?.includes('budget'))).toBe(true);
  });

  it('partial budget allows crawl but not hunter', async () => {
    const { repo, monid, env, ...none } = setup({}, { OUTREACH_MAX_SPEND_USD: 0.01 });
    await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env, ...none });
    expect(monid.callsTo('hunterio/domain-search')).toBe(0);
    expect(monid.callsTo('search1api/crawl')).toBeGreaterThan(0);
    expect(monid.calls.length).toBeLessThan(12);
  });

  it('isolates a failing source: maps fails -> nearby fallback', async () => {
    const { repo, monid, env, ...none } = setup();
    monid.override('litescrape/google/maps', { error: 'down' });
    monid.override('hunterio/domain-search', publishedEmail('info@x.com'));
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env, ...none });
    expect(res.runs.find((r) => r.source.includes('google/maps'))!.error).toBeTruthy();
    expect(res.runs.find((r) => r.source.includes('search_nearby'))!.leads).toBeGreaterThan(0);
    expect(res.output.candidates.length).toBeGreaterThan(0);
  });

  it('falls back to nearby when maps returns 0', async () => {
    const { repo, monid, env, ...none } = setup();
    monid.override('litescrape/google/maps', { output: { local_results: [] } });
    await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env, ...none });
    expect(monid.callsTo('anyapi/maps.search_nearby')).toBeGreaterThan(0);
  });

  it('survives every source failing', async () => {
    const { repo, monid, env, ...none } = setup();
    for (const k of ['litescrape/google/maps', 'anyapi/maps.search_nearby']) monid.override(k, { error: 'x' });
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env, ...none });
    expect(res.output.candidates).toEqual([]);
    expect(res.runs.every((r) => r.error)).toBe(true);
  });

  it('enrichment failure does not fail the call', async () => {
    const { repo, monid, env, ...none } = setup();
    monid.override('hunterio/domain-search', { error: 'x' });
    monid.override('search1api/crawl', { error: 'x' });
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env, ...none });
    expect(res.runs.find((r) => r.source.includes('hunterio'))!.error).toBeTruthy();
    expect(res.output.candidates).toEqual([]);
  });

  it('regulars rank first; opted-out regulars and opted-out matches excluded', async () => {
    const { repo, monid, env, ...none } = setup();
    monid.override('hunterio/domain-search', publishedEmail('info@x.com'));
    const reg = repo.addPerson({ dedupe_key: 'k1', name: 'Reggie', email: 'reg@x.com', regular: true, lat: 37.78, lng: -122.41, kind: 'person' });
    repo.addPerson({ dedupe_key: 'k2', name: 'Gone', email: 'gone@x.com', regular: true, opted_out: true, lat: 37.78, lng: -122.41 });
    // an opted-out person matching a Maps result by phone must not come back
    repo.addPerson({ dedupe_key: 'phone:+18883514126', name: 'Kinetic Events Staffing', email: 'k@kinetic.com', opted_out: true });
    const res = await findPeople({ job_id: 'job1' }, { repo, monid, env, ...none });
    expect(res.candidates[0]!.candidate_id).toBe(reg.id);
    expect(res.candidates[0]!.source).toBe('regular');
    expect(res.candidates.some((c) => c.name === 'Gone' || c.name === 'Kinetic Events Staffing')).toBe(false);
  });

  it('channel rules: sms only for regulars with consent + phone; cold phone-only dropped', async () => {
    const { repo, monid, env, ...none } = setup();
    const sms = repo.addPerson({ dedupe_key: 'a', name: 'Sms', phone: '+14155550101', regular: true, sms_consent: true, lat: 37.78, lng: -122.41 });
    repo.addPerson({ dedupe_key: 'b', name: 'NoConsent', phone: '+14155550102', regular: true, lat: 37.78, lng: -122.41 });
    const emailReg = repo.addPerson({ dedupe_key: 'c', name: 'Mail', email: 'm@x.com', phone: '+14155550103', regular: true, lat: 37.78, lng: -122.41 });
    const res = await findPeople({ job_id: 'job1' }, { repo, monid, env, ...none });
    const byId = new Map(res.candidates.map((c) => [c.candidate_id, c]));
    expect(byId.get(sms.id)!.channel).toBe('sms');
    expect(byId.get(emailReg.id)!.channel).toBe('email');
    expect(res.candidates.find((c) => c.name === 'NoConsent')).toBeUndefined();
    expect(res.candidates.filter((c) => c.channel === 'sms')).toHaveLength(1);
  });

  it('output stays under 8000 chars at limit 50', async () => {
    const { repo, monid, env, ...none } = setup({}, { OUTREACH_RADIUS_KM: 50 });
    for (let i = 0; i < 60; i++) {
      repo.addPerson({ dedupe_key: `r${i}`, name: `Very Long Regular Business Name Number ${i} LLC Incorporated`, email: `r${i}@x.com`, regular: true, lat: 37.78, lng: -122.41 });
    }
    const res = await findPeople({ job_id: 'job1', limit: 500 }, { repo, monid, env, ...none });
    expect(res.candidates.length).toBeGreaterThan(30);
    expect(JSON.stringify(res).length).toBeLessThan(8000);
  });

  it('is idempotent across repeated calls (upsert by dedupe key)', async () => {
    const { repo, monid, env, ...none } = setup();
    await findPeople({ job_id: 'job1' }, { repo, monid, env, ...none });
    const n = repo.people.size;
    await findPeople({ job_id: 'job1' }, { repo, monid, env, ...none });
    expect(repo.people.size).toBe(n);
  });
});

describe('findPeople reuse', () => {
  it('does not pay to enrich a business already saved with an email, or one that opted out', async () => {
    const { repo, monid, env, ...none } = setup();
    monid.override('search1api/crawl', { output: { results: { content: 'write info@acme.com' } } });
    await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env, ...none });
    const firstCrawls = monid.callsTo('search1api/crawl');
    expect(firstCrawls).toBeGreaterThan(0);
    await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env, ...none });
    expect(monid.callsTo('search1api/crawl')).toBe(firstCrawls);
  });
});

describe('findPeople radius', () => {
  it('never returns candidates outside OUTREACH_RADIUS_KM', async () => {
    const { repo, monid, env, ...none } = setup();
    monid.override('hunterio/domain-search', publishedEmail('info@x.com'));
    const res = await findPeopleDetailed({ job_id: 'job1', limit: 50 }, { repo, monid, env, ...none });
    for (const c of res.output.candidates) {
      if (c.distance_km !== null) expect(c.distance_km).toBeLessThanOrEqual(env.OUTREACH_RADIUS_KM);
    }
  });
});

// ---------- individuals: remote and on-site ----------

const li = (h: string) => ({ platform: 'linkedin' as const, url: `https://www.linkedin.com/in/${h}`, handle: h });
const person = (o: Partial<Lead>): Lead => ({
  name: null, kind: 'person', email: null, phone: null, website: null, profile_url: null, address: null, lat: null, lng: null,
  source: 'monid:test/people', source_ref: null, categories: [], rating: null, snippet: null, ...o,
});
const fakeSource = (leads: Lead[], over: Partial<SourceAdapter> = {}): SourceAdapter & { seen: unknown[] } => {
  const seen: unknown[] = [];
  return { id: 'monid:test/people', costEstimateUsd: 0.01, perQuery: false, seen, run: async (ctx) => (seen.push(ctx), { leads, cost_usd: 0.01 }), ...over };
};

describe('findPeople: remote job (legal review)', () => {
  const legalJob = { title: 'Review our SaaS terms of service', instructions: 'Online contract review', certification_required: 'California bar license', remote: true };
  const leads = [
    person({ name: 'Alice Attorney', email: 'alice@law.example', headline: 'Freelance contract attorney | SaaS', credentials: ['California Bar'], location_text: 'London, UK', profiles: [li('alice')], open_to_work: true }),
    person({ name: 'Bob NoBar', email: 'bob@x.example', headline: 'Contract attorney', location_text: 'Sydney', profiles: [li('bob')] }),
    person({ name: 'Dan DM', headline: 'Freelance contract attorney', credentials: ['California Bar'], location_text: 'Tokyo', profiles: [li('dan')] }),
    person({ name: 'Cara Baker', email: 'cara@x.example', headline: 'Pastry chef', profiles: [li('cara')] }),
  ];

  it('ranks credentialed attorneys with email first, ignores distance, no Maps, passes hints to sources', async () => {
    const { repo, monid, env } = setup(legalJob);
    const src = fakeSource(leads);
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env, sources: [src], enrichers: [] });
    expect(res.plan).toMatchObject({ remote: true, roles: ['contract attorney', 'paralegal'], credential: 'California bar license' });
    const names = res.output.candidates.map((c) => c.name);
    expect(names[0]).toBe('Alice Attorney');
    expect(names.indexOf('Dan DM')).toBeLessThan(names.indexOf('Bob NoBar')); // credential beats email without credential
    expect(res.output.candidates.every((c) => c.distance_km === null)).toBe(true);
    expect(res.output.candidates[0]).toMatchObject({ channel: 'email', source: 'people_search' });
    expect(res.output.candidates.find((c) => c.name === 'Dan DM')!.channel).toBe('linkedin_manual');
    expect(monid.calls).toHaveLength(0);
    const ctx = src.seen[0] as { remote: boolean; hints: { roles: string[]; credential: string }; queries: string[] };
    expect(ctx.remote).toBe(true);
    expect(ctx.hints.credential).toBe('California bar license');
    expect(ctx.queries).toEqual(['contract attorney', 'paralegal']);
  });

  it('agent hints override the heuristics', async () => {
    const { repo, monid, env } = setup(legalJob);
    const src = fakeSource([]);
    const res = await findPeopleDetailed(
      { job_id: 'job1', hints: { roles: ['IP lawyer'], skills: ['patents'], credential: null, remote: true } },
      { repo, monid, env, sources: [src], enrichers: [] },
    );
    expect(res.plan).toMatchObject({ roles: ['IP lawyer'], skills: ['patents'], credential: null });
    expect((src.seen[0] as { queries: string[] }).queries).toEqual(['IP lawyer']);
  });

  it('manual-channel candidates are included when there is no email', async () => {
    const { repo, monid, env } = setup(legalJob);
    const res = await findPeople({ job_id: 'job1' }, { repo, monid, env, sources: [fakeSource([{ ...leads[2]! }])], enrichers: [] });
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]!.channel).toBe('linkedin_manual');
  });

  it('merges the same LinkedIn handle from two sources into one person', async () => {
    const { repo, monid, env } = setup(legalJob);
    const a = fakeSource([person({ name: 'Alice A', source: 'monid:google/profiles', headline: 'Attorney', profiles: [li('alice')] })], { id: 'monid:google/profiles' });
    const b = fakeSource([person({ name: 'Alice Attorney', source: 'monid:ploid/linkedin/search', headline: 'Freelance contract attorney | SaaS', credentials: ['California Bar'], profiles: [li('alice')] })], { id: 'monid:ploid/linkedin/search' });
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env, sources: [a, b], enrichers: [] });
    expect(res.output.candidates).toHaveLength(1);
    expect(repo.people.size).toBe(1);
    expect(res.output.candidates[0]!.channel).toBe('linkedin_manual');
  });

  it('person enrichers: cheapest first, stop at first email, respect applies()', async () => {
    const { repo, monid, env } = setup(legalJob);
    const order: string[] = [];
    const mk = (id: string, cost: number, email: string | null, applies?: Enricher['applies']): Enricher => ({
      id, costEstimateUsd: cost, applies,
      enrich: async () => (order.push(id), { email, phone: null, cost_usd: cost }),
    });
    const enrichers = [mk('pricey', 0.05, 'p@x.example'), mk('cheap', 0.001, null), mk('never', 0.002, 'n@x.example', () => false)];
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env, sources: [fakeSource([{ ...leads[2]! }])], enrichers });
    expect(order).toEqual(['cheap', 'pricey']);
    expect(res.output.candidates[0]!.channel).toBe('email');
    expect(res.spend_usd).toBeCloseTo(0.01 + 0.001 + 0.05, 6);
  });

  it('budget cap: sources and enrichers skip when unaffordable', async () => {
    const { repo, monid, env } = setup(legalJob, { OUTREACH_MAX_SPEND_USD: 0.012 });
    const first = fakeSource([{ ...leads[2]! }]);
    const second = fakeSource([leads[0]!], { id: 'monid:second' });
    const enr: Enricher = { id: 'enr', costEstimateUsd: 0.05, enrich: async () => ({ email: 'x@y.example', phone: null, cost_usd: 0.05 }) };
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env, sources: [first, second], enrichers: [enr] });
    expect(first.seen).toHaveLength(1);
    expect(second.seen).toHaveLength(0);
    expect(res.runs.find((r) => r.source === 'monid:second')!.error).toMatch(/budget/);
    expect(res.runs.find((r) => r.source === 'enr')!.error).toMatch(/budget/);
    expect(res.spend_usd).toBeLessThanOrEqual(0.012);
  });

  it('remote regulars that fit the roles are included, others are not', async () => {
    const { repo, monid, env } = setup(legalJob);
    const fit = repo.addPerson({ dedupe_key: 'r1', name: 'Reg Lawyer', email: 'r@x.example', regular: true, lat: 10, lng: 10, headline: 'Contract attorney' });
    repo.addPerson({ dedupe_key: 'r2', name: 'Reg Plumber', email: 'p@x.example', regular: true, lat: 10, lng: 10, headline: 'Plumber' });
    const res = await findPeople({ job_id: 'job1' }, { repo, monid, env, sources: [], enrichers: [] });
    expect(res.candidates.map((c) => c.candidate_id)).toEqual([fit.id]);
  });
});

describe('findPeople: on-site job with people sources', () => {
  it('drops far leads, keeps nearby, and keeps coordinate-less people only when in the job area', async () => {
    const { repo, monid, env } = setup({ address: '1 Market St, San Francisco, CA 94105' });
    monid.override('litescrape/google/maps', { output: { local_results: [] } });
    monid.override('anyapi/maps.search_nearby', { output: { places: [] } });
    const src = fakeSource([
      person({ name: 'Near Nina', email: 'n@x.example', lat: 37.78, lng: -122.41, headline: 'Brand ambassador' }),
      person({ name: 'Far Fred', email: 'f@x.example', lat: 40.7, lng: -74, headline: 'Brand ambassador' }),
      person({ name: 'Bay Betty', email: 'b@x.example', location_text: 'San Francisco Bay Area', headline: 'Brand ambassador' }),
      person({ name: 'Austin Al', email: 'a@x.example', location_text: 'Austin, TX', headline: 'Brand ambassador' }),
      person({ name: 'Remote Rae', email: 'r@x.example', location_text: 'Remote', headline: 'Brand ambassador' }),
    ]);
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env, sources: [src], enrichers: [] });
    expect(res.plan).toMatchObject({ remote: false, locationText: 'San Francisco' });
    const names = res.output.candidates.map((c) => c.name);
    expect(names).toContain('Near Nina');
    expect(names).toContain('Bay Betty');
    expect(names).toContain('Remote Rae');
    expect(names).not.toContain('Far Fred');
    expect(names).not.toContain('Austin Al');
    expect(names[0]).toBe('Near Nina'); // distance matters on-site
    expect(res.output.candidates[0]!.distance_km).not.toBeNull();
    expect((src.seen[0] as { queries: string[] }).queries[0]).toBe('brand ambassador San Francisco');
  });

  it('still uses Google Maps as a backup alongside people sources', async () => {
    const { repo, monid, env } = setup();
    monid.override('hunterio/domain-search', publishedEmail('info@x.com'));
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env, sources: [fakeSource([person({ name: 'Near Nina', email: 'n@x.example', lat: 37.78, lng: -122.41 })])], enrichers: [] });
    expect(monid.callsTo('litescrape/google/maps')).toBeGreaterThan(0);
    expect(res.output.candidates.some((c) => c.name === 'Near Nina')).toBe(true);
    expect(res.output.candidates.some((c) => c.source === 'google_maps')).toBe(true);
    // individuals outrank businesses with the same signals
    expect(res.output.candidates.findIndex((c) => c.name === 'Near Nina')).toBeLessThan(res.output.candidates.findIndex((c) => c.source === 'google_maps'));
  });
});
