import { describe, expect, it } from 'vitest';
import { findPeople, findPeopleDetailed } from '../src/find.js';
import { InMemoryRepo } from '../src/repo/memory.js';
import { FakeMonid, makeEnv, makeJob } from './helpers/fakeMonid.js';

function setup(jobOver = {}, envOver = {}) {
  const repo = new InMemoryRepo();
  repo.addJob(makeJob(jobOver));
  const monid = new FakeMonid();
  return { repo, monid, env: makeEnv(envOver) };
}

const publishedEmail = (e: string) => ({ output: { data: { emails: [{ value: e, type: 'generic', confidence: 90, sources: [{}] }] } } });

describe('findPeople', () => {
  it('throws clearly for missing job or no coordinates', async () => {
    const { repo, monid, env } = setup({ lat: null });
    await expect(findPeople({ job_id: 'nope' }, { repo, monid, env })).rejects.toThrow(/not found/);
    await expect(findPeople({ job_id: 'job1' }, { repo, monid, env })).rejects.toThrow(/lat\/lng/);
  });

  it('finds businesses, enriches with email, ranks, saves, records cost', async () => {
    const { repo, monid, env } = setup();
    monid.override('hunterio/domain-search', publishedEmail('info@kineticevents.com'));
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env });
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
    const { repo, monid, env } = setup();
    monid.override('search1api/crawl', { output: { results: { content: 'write info@acme.com' } } });
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env });
    const crawls = monid.callsTo('search1api/crawl');
    expect(crawls).toBeGreaterThan(0);
    expect(crawls).toBeLessThanOrEqual(12);
    expect(monid.callsTo('hunterio/domain-search')).toBe(0);
    expect(res.output.candidates.length).toBeGreaterThan(0);
  });

  it('falls back to hunter when the crawl finds no email', async () => {
    const { repo, monid, env } = setup();
    monid.override('search1api/crawl', { output: { results: { content: 'no contact here' } } });
    monid.override('hunterio/domain-search', publishedEmail('info@x.com'));
    await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env });
    // 3 pages (home, /contact, /contact-us) per lead before hunter
    expect(monid.callsTo('search1api/crawl')).toBe(3 * monid.callsTo('hunterio/domain-search'));
    expect(monid.callsTo('hunterio/domain-search')).toBeGreaterThan(0);
  });

  it('budget cap stops paid calls', async () => {
    const { repo, monid, env } = setup({}, { OUTREACH_MAX_SPEND_USD: 0.0002 });
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env });
    expect(monid.callsTo('litescrape/google/maps')).toBe(1);
    expect(monid.callsTo('hunterio/domain-search')).toBe(0);
    expect(res.spend_usd).toBeLessThanOrEqual(0.0002);
    expect(res.runs.some((r) => r.error?.includes('budget'))).toBe(true);
  });

  it('partial budget allows crawl but not hunter', async () => {
    const { repo, monid, env } = setup({}, { OUTREACH_MAX_SPEND_USD: 0.01 });
    await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env });
    expect(monid.callsTo('hunterio/domain-search')).toBe(0);
    expect(monid.callsTo('search1api/crawl')).toBeGreaterThan(0);
    expect(monid.calls.length).toBeLessThan(12);
  });

  it('isolates a failing source: maps fails -> nearby fallback', async () => {
    const { repo, monid, env } = setup();
    monid.override('litescrape/google/maps', { error: 'down' });
    monid.override('hunterio/domain-search', publishedEmail('info@x.com'));
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env });
    expect(res.runs.find((r) => r.source.includes('google/maps'))!.error).toBeTruthy();
    expect(res.runs.find((r) => r.source.includes('search_nearby'))!.leads).toBeGreaterThan(0);
    expect(res.output.candidates.length).toBeGreaterThan(0);
  });

  it('falls back to nearby when maps returns 0', async () => {
    const { repo, monid, env } = setup();
    monid.override('litescrape/google/maps', { output: { local_results: [] } });
    await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env });
    expect(monid.callsTo('anyapi/maps.search_nearby')).toBeGreaterThan(0);
  });

  it('survives every source failing', async () => {
    const { repo, monid, env } = setup();
    for (const k of ['litescrape/google/maps', 'anyapi/maps.search_nearby']) monid.override(k, { error: 'x' });
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env });
    expect(res.output.candidates).toEqual([]);
    expect(res.runs.every((r) => r.error)).toBe(true);
  });

  it('enrichment failure does not fail the call', async () => {
    const { repo, monid, env } = setup();
    monid.override('hunterio/domain-search', { error: 'x' });
    monid.override('search1api/crawl', { error: 'x' });
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env });
    expect(res.runs.find((r) => r.source.includes('hunterio'))!.error).toBeTruthy();
    expect(res.output.candidates).toEqual([]);
  });

  it('regulars rank first; opted-out regulars and opted-out matches excluded', async () => {
    const { repo, monid, env } = setup();
    monid.override('hunterio/domain-search', publishedEmail('info@x.com'));
    const reg = repo.addPerson({ dedupe_key: 'k1', name: 'Reggie', email: 'reg@x.com', regular: true, lat: 37.78, lng: -122.41, kind: 'person' });
    repo.addPerson({ dedupe_key: 'k2', name: 'Gone', email: 'gone@x.com', regular: true, opted_out: true, lat: 37.78, lng: -122.41 });
    // an opted-out person matching a Maps result by phone must not come back
    repo.addPerson({ dedupe_key: 'phone:+18883514126', name: 'Kinetic Events Staffing', email: 'k@kinetic.com', opted_out: true });
    const res = await findPeople({ job_id: 'job1' }, { repo, monid, env });
    expect(res.candidates[0]!.candidate_id).toBe(reg.id);
    expect(res.candidates[0]!.source).toBe('regular');
    expect(res.candidates.some((c) => c.name === 'Gone' || c.name === 'Kinetic Events Staffing')).toBe(false);
  });

  it('channel rules: sms only for regulars with consent + phone; cold phone-only dropped', async () => {
    const { repo, monid, env } = setup();
    const sms = repo.addPerson({ dedupe_key: 'a', name: 'Sms', phone: '+14155550101', regular: true, sms_consent: true, lat: 37.78, lng: -122.41 });
    repo.addPerson({ dedupe_key: 'b', name: 'NoConsent', phone: '+14155550102', regular: true, lat: 37.78, lng: -122.41 });
    const emailReg = repo.addPerson({ dedupe_key: 'c', name: 'Mail', email: 'm@x.com', phone: '+14155550103', regular: true, lat: 37.78, lng: -122.41 });
    const res = await findPeople({ job_id: 'job1' }, { repo, monid, env });
    const byId = new Map(res.candidates.map((c) => [c.candidate_id, c]));
    expect(byId.get(sms.id)!.channel).toBe('sms');
    expect(byId.get(emailReg.id)!.channel).toBe('email');
    expect(res.candidates.find((c) => c.name === 'NoConsent')).toBeUndefined();
    expect(res.candidates.filter((c) => c.channel === 'sms')).toHaveLength(1);
  });

  it('output stays under 8000 chars at limit 50', async () => {
    const { repo, monid, env } = setup({}, { OUTREACH_RADIUS_KM: 50 });
    for (let i = 0; i < 60; i++) {
      repo.addPerson({ dedupe_key: `r${i}`, name: `Very Long Regular Business Name Number ${i} LLC Incorporated`, email: `r${i}@x.com`, regular: true, lat: 37.78, lng: -122.41 });
    }
    const res = await findPeople({ job_id: 'job1', limit: 500 }, { repo, monid, env });
    expect(res.candidates.length).toBeGreaterThan(30);
    expect(JSON.stringify(res).length).toBeLessThan(8000);
  });

  it('linkedin only called when certification_required', async () => {
    const a = setup();
    await findPeople({ job_id: 'job1' }, { repo: a.repo, monid: a.monid, env: a.env });
    expect(a.monid.callsTo('ploid/linkedin/search')).toBe(0);
    const b = setup({ certification_required: 'notary' });
    const res = await findPeopleDetailed({ job_id: 'job1' }, { repo: b.repo, monid: b.monid, env: b.env });
    expect(b.monid.callsTo('ploid/linkedin/search')).toBe(1);
    expect(b.monid.calls.find((c) => c.provider === 'ploid')!.input.body).toMatchObject({ limit: 5 });
    // person without contact info is saved but dropped from candidates
    expect([...b.repo.people.values()].some((p) => p.kind === 'person' && p.profile_url)).toBe(true);
    expect(res.output.candidates.every((c) => c.source !== 'linkedin')).toBe(true);
  });

  it('is idempotent across repeated calls (upsert by dedupe key)', async () => {
    const { repo, monid, env } = setup();
    await findPeople({ job_id: 'job1' }, { repo, monid, env });
    const n = repo.people.size;
    await findPeople({ job_id: 'job1' }, { repo, monid, env });
    expect(repo.people.size).toBe(n);
  });
});

describe('findPeople reuse', () => {
  it('does not pay to enrich a business already saved with an email, or one that opted out', async () => {
    const { repo, monid, env } = setup();
    monid.override('search1api/crawl', { output: { results: { content: 'write info@acme.com' } } });
    await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env });
    const firstCrawls = monid.callsTo('search1api/crawl');
    expect(firstCrawls).toBeGreaterThan(0);
    await findPeopleDetailed({ job_id: 'job1' }, { repo, monid, env });
    expect(monid.callsTo('search1api/crawl')).toBe(firstCrawls);
  });
});

describe('findPeople radius', () => {
  it('never returns candidates outside OUTREACH_RADIUS_KM', async () => {
    const { repo, monid, env } = setup();
    monid.override('hunterio/domain-search', publishedEmail('info@x.com'));
    const res = await findPeopleDetailed({ job_id: 'job1', limit: 50 }, { repo, monid, env });
    for (const c of res.output.candidates) {
      if (c.distance_km !== null) expect(c.distance_km).toBeLessThanOrEqual(env.OUTREACH_RADIUS_KM);
    }
  });
});
