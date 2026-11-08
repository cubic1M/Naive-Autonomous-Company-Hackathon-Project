import { describe, expect, it } from 'vitest';
import { FakeMonid, fixture, makeCtx, makeJob } from '../helpers/fakeMonid.js';
import { buildGoogleQueries, cityFromAddress, googleProfiles, parseGoogleProfiles, roleFamily, splitTitle } from '../../src/sources/people/googleProfiles.js';
import { linkedinPeople, buildLinkedinFilters, parseLinkedinPeople } from '../../src/sources/people/linkedinPeople.js';
import { buildPeopleQuery, parsePeopleSearch, peopleSearch } from '../../src/sources/people/peopleSearch.js';
import { parseXUsers, xUsers, buildXQueries } from '../../src/sources/people/xUsers.js';
import { buildRedditQueries, parseRedditForHire, redditForHire } from '../../src/sources/people/redditForHire.js';
import { detectCredentials, isOpenToWork } from '../../src/sources/people/common.js';
import { peopleSources } from '../../src/sources/people/index.js';
import { SourceError } from '../../src/sources/types.js';

const sfJob = makeJob({ address: '1 Market St, San Francisco, CA 94105' });
const legal = { job: makeJob({ title: 'Review SaaS terms of service', remote: true, address: null }), remote: true, hints: { roles: ['contract attorney', 'paralegal'], skills: ['SaaS', 'terms of service'], credential: 'California bar license' } };
const react = { job: makeJob({ remote: true, address: null }), remote: true, hints: { roles: ['React developer'], skills: ['TypeScript'], credential: null } };
const logo = { job: makeJob({ remote: true, address: null }), remote: true, hints: { roles: ['logo designer'], skills: [], credential: null } };
const sign = { job: sfJob, remote: false, hints: { roles: ['brand ambassador', 'sign holder'], skills: [], credential: null } };
const notary = { job: sfJob, remote: false, hints: { roles: ['notary public'], skills: [], credential: 'notary public' } };

describe('google query builder', () => {
  it('classifies role families', () => {
    expect(roleFamily('contract attorney')).toBe('legal');
    expect(roleFamily('React developer')).toBe('software');
    expect(roleFamily('logo designer')).toBe('design');
    expect(roleFamily('wedding photographer')).toBe('media');
    expect(roleFamily('hold a sign')).toBe('gig');
    expect(roleFamily('mobile notary')).toBe('notary');
  });
  it('legal -> linkedin/avvo/justia, no city for remote', () => {
    const qs = buildGoogleQueries(legal);
    expect(qs.length).toBeGreaterThanOrEqual(3);
    expect(qs.length).toBeLessThanOrEqual(6);
    expect(qs[0]).toContain('site:linkedin.com/in');
    expect(qs[0]).toContain('("contract attorney" OR paralegal)');
    expect(qs.some((q) => q.includes('site:avvo.com/attorneys'))).toBe(true);
    expect(qs.join(' ')).not.toContain('San Francisco');
    expect(qs.some((q) => q.startsWith('"freelance contract attorney"'))).toBe(true);
  });
  it('software -> github first with open-to-work', () => {
    const qs = buildGoogleQueries(react);
    expect(qs[0]).toContain('site:github.com');
    expect(qs[0]).toContain('"open to work"');
    expect(qs.some((q) => q.includes('site:linkedin.com/in'))).toBe(true);
  });
  it('design -> behance/dribbble', () => {
    const qs = buildGoogleQueries(logo);
    expect(qs[0]).toContain('site:behance.net');
    expect(qs.some((q) => q.includes('site:dribbble.com'))).toBe(true);
  });
  it('on-site gig adds the city to every query', () => {
    const qs = buildGoogleQueries(sign);
    expect(qs.every((q) => q.includes('"San Francisco"'))).toBe(true);
    expect(qs.some((q) => q.includes('site:x.com'))).toBe(true);
  });
  it('notary uses notary directories', () => {
    expect(buildGoogleQueries(notary).some((q) => q.includes('123notary.com'))).toBe(true);
  });
  it('city parsing', () => {
    expect(cityFromAddress('1 Market St, San Francisco, CA 94105')).toBe('San Francisco');
    expect(cityFromAddress('SF')).toBe('San Francisco');
    expect(cityFromAddress(null)).toBeNull();
  });
});

describe('google parser', () => {
  it('parses legal fixture into LinkedIn person leads', () => {
    const leads = parseGoogleProfiles(fixture('litescrape__google_search_legal'));
    expect(leads).toHaveLength(5); // the /jobs/ result is dropped
    const l = leads[0]!;
    expect(l.kind).toBe('person');
    expect(l.name).toBe('Samantha Fino');
    expect(l.headline).toBe('Paralegal & Contract Review Consultant');
    expect(l.profiles?.[0]).toMatchObject({ platform: 'linkedin', url: 'https://www.linkedin.com/in/samantha-fino-0a85b42a7' });
    expect(l.profile_url).toBe(l.profiles?.[0]?.url);
    expect(l.location_text).toBe('New York City Metropolitan Area');
    expect(l.open_to_work).toBe(true);
    expect(l.source).toBe('monid:litescrape/google/search');
    expect(leads.every((x) => !x.profile_url?.includes('/jobs'))).toBe(true);
    expect(leads[2]!.profile_url).toBe('https://www.linkedin.com/in/nikita-mukati');
  });
  it('parses X results, stripping "(@handle) / X"', () => {
    const leads = parseGoogleProfiles(fixture('litescrape__google_search_sf'));
    expect(leads[0]).toMatchObject({ name: 'Kate Hua' });
    expect(leads[0]!.profiles?.[0]).toMatchObject({ platform: 'x', handle: 'katehua24' });
    expect(leads[0]!.open_to_work).toBe(true);
  });
  it('splits titles', () => {
    expect(splitTitle('Jane Roe - Contract Paralegal | LinkedIn')).toEqual({ name: 'Jane Roe', headline: 'Contract Paralegal' });
    expect(splitTitle('Bob (@bob) / X').name).toBe('Bob');
  });
  it('drops non-profiles and aggregator sites, keeps shallow portfolio sites, extracts emails + credentials', () => {
    const out = {
      organic_results: [
        { title: 'Jobs', link: 'https://www.linkedin.com/jobs/view/123', snippet: 'x' },
        { title: 'Top 10', link: 'https://www.indeed.com/q-paralegal-jobs.html', snippet: 'x' },
        { title: 'Blog post', link: 'https://bigsite.com/blog/how-to-hire', snippet: 'x' },
        { title: 'Jane Roe, Esq. - Attorney', link: 'https://janeroe.law/contact', snippet: 'Attorney at Law, licensed in CA. Email jane@janeroe.law. Available for contract work.' },
      ],
    };
    const leads = parseGoogleProfiles(out);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ name: 'Jane Roe', email: 'jane@janeroe.law', website: 'https://janeroe.law', open_to_work: true });
    expect(leads[0]!.credentials).toContain('Attorney at Law');
    expect(leads[0]!.credentials).toContain('Licensed');
  });
  it('open_to_work / credential helpers', () => {
    expect(isOpenToWork('Open to work')).toBe(true);
    expect(isOpenToWork('Senior VP of Sales')).toBe(false);
    expect(detectCredentials('Commissioned notary public, CPA')).toEqual(['Notary Public', 'CPA']);
  });
});

describe('google adapter', () => {
  it('runs one call per query, perQuery true, sums cost', async () => {
    const m = new FakeMonid().override('litescrape/google/search', { output: fixture('litescrape__google_search_legal'), cost: 0.00015 });
    const ctx = makeCtx({ monid: m, ...legal });
    const r = await googleProfiles.run(ctx);
    expect(googleProfiles.perQuery).toBe(true);
    expect(m.callsTo('litescrape/google/search')).toBe(buildGoogleQueries(legal).length);
    expect(r.cost_usd).toBeCloseTo(0.00015 * m.calls.length, 8);
    expect(r.leads.length).toBe(5 * m.calls.length);
  });
  it('throws SourceError when every call fails', async () => {
    const m = new FakeMonid().override('litescrape/google/search', { error: 'boom' });
    await expect(googleProfiles.run(makeCtx({ monid: m, ...legal }))).rejects.toBeInstanceOf(SourceError);
  });
  it('tolerates partial failure', async () => {
    let n = 0;
    const m = new FakeMonid().override('litescrape/google/search', () => {
      if (n++ === 0) throw new Error('x');
      return fixture('litescrape__google_search_sf');
    });
    const r = await googleProfiles.run(makeCtx({ monid: m, ...sign }));
    expect(r.leads.length).toBeGreaterThan(0);
  });
});

describe('linkedin people', () => {
  it('filters: location only on-site, limit <= 10', async () => {
    expect(buildLinkedinFilters(legal)).toEqual({ keywords: 'contract attorney paralegal', title: 'contract attorney' });
    expect(buildLinkedinFilters(sign)).toMatchObject({ location: 'San Francisco' });
    const m = new FakeMonid().override('ploid/linkedin/search', { output: fixture('ploid__linkedin_search_people'), cost: 0.03 });
    const r = await linkedinPeople.run(makeCtx({ monid: m, ...legal }));
    expect((m.calls[0]!.input.body as { limit: number }).limit).toBeLessThanOrEqual(10);
    expect(r.cost_usd).toBe(0.03);
    expect(r.leads).toHaveLength(3);
  });
  it('parses fixture', () => {
    const l = parseLinkedinPeople(fixture('ploid__linkedin_search_people'))[0]!;
    expect(l).toMatchObject({ kind: 'person', name: 'Saas Saas', location_text: 'Greater Toulouse Metropolitan Area, FR' });
    expect(l.profiles?.[0]?.platform).toBe('linkedin');
  });
  it('SourceError on failure', async () => {
    const m = new FakeMonid().override('ploid/linkedin/search', { error: 'x' });
    await expect(linkedinPeople.run(makeCtx({ monid: m, ...legal }))).rejects.toBeInstanceOf(SourceError);
  });
});

describe('context.dev people search', () => {
  it('builds natural-language query', () => {
    expect(buildPeopleQuery(legal)).toBe('freelance contract attorney or paralegal experienced in SaaS, terms of service');
    expect(buildPeopleQuery(sign)).toContain('in San Francisco');
  });
  it('parses fixture', () => {
    const leads = parsePeopleSearch(fixture('context.dev__people_search'));
    expect(leads).toHaveLength(5);
    expect(leads[0]).toMatchObject({ name: 'Kaitlin Adams', headline: 'Contract Review Attorney', location_text: 'Seattle, Washington, US' });
    expect(leads[0]!.profiles?.[0]).toMatchObject({ platform: 'linkedin', url: 'https://www.linkedin.com/in/kaitlinsadams' });
    expect(leads[0]!.open_to_work).toBe(true);
  });
  it('runs', async () => {
    const m = new FakeMonid().override('context.dev/people/search', { output: fixture('context.dev__people_search'), cost: 0.02 });
    const r = await peopleSearch.run(makeCtx({ monid: m, ...legal }));
    expect(r.leads).toHaveLength(5);
    expect(m.callsTo('context.dev/people/search')).toBe(1);
  });
});

describe('x users', () => {
  it('queries include city only on-site', () => {
    expect(buildXQueries(sign)[0]).toContain('San Francisco');
    expect(buildXQueries(legal)[0]).toBe('contract attorney freelance');
  });
  it('parses fixture with handles', () => {
    const leads = parseXUsers(fixture('anyapi__twitter.search_users'));
    expect(leads).toHaveLength(4);
    expect(leads[1]).toMatchObject({ name: expect.stringContaining(''), location_text: 'Leeds,Yorkshire, Great Britain', open_to_work: true });
    expect(leads[1]!.profiles?.[0]).toMatchObject({ platform: 'x', url: 'https://x.com/gilesrocholl' });
  });
  it('extracts bio email and website', () => {
    const l = parseXUsers({ data: { users: [{ username: 'Jo', id: '1', name: 'Jo', bio: 'Freelance designer. jo@jodesign.co https://jodesign.co/ https://t.co/abc', location: 'SF' }] } })[0]!;
    expect(l.email).toBe('jo@jodesign.co');
    expect(l.website).toBe('https://jodesign.co');
    expect(l.profiles?.map((p) => p.platform)).toEqual(['x', 'website']);
  });
  it('one call per query; SourceError if all fail', async () => {
    const m = new FakeMonid().override('anyapi/twitter.search_users', { output: fixture('anyapi__twitter.search_users'), cost: 0.0005 });
    const r = await xUsers.run(makeCtx({ monid: m, ...legal }));
    expect(m.calls).toHaveLength(2);
    expect(r.cost_usd).toBeCloseTo(0.001, 6);
    const bad = new FakeMonid().override('anyapi/twitter.search_users', { error: 'x' });
    await expect(xUsers.run(makeCtx({ monid: bad, ...legal }))).rejects.toBeInstanceOf(SourceError);
  });
});

describe('reddit for hire', () => {
  it('subreddits: forhire always, SF subs on-site SF', () => {
    expect(buildRedditQueries(legal).map((q) => q.subreddit)).toEqual(['forhire']);
    expect(buildRedditQueries(sign).map((q) => q.subreddit)).toEqual(['forhire', 'sanfrancisco', 'bayarea']);
  });
  it('keeps only [For Hire] posts', () => {
    const leads = parseRedditForHire(fixture('anyapi__reddit.subreddit_search'));
    expect(leads.length).toBeGreaterThan(0);
    expect(leads.every((l) => l.open_to_work && l.profiles?.[0]?.platform === 'reddit')).toBe(true);
    expect(leads[0]!.last_active_at).toMatch(/^20\d\d-/);
    expect(leads.some((l) => /hiring/i.test(l.snippet ?? '') && !/for hire/i.test(l.snippet ?? ''))).toBe(false);
  });
  it('extracts emails and portfolio links from the body', () => {
    const l = parseRedditForHire({ data: { posts: [
      { author: 'pat', id: 'a', createdUtc: 1790000000, title: '[FOR HIRE] Notary in SF', selftext: 'Email me at pat@notarypat.com or see https://notarypat.com/ and https://www.reddit.com/r/forhire/x' },
      { author: 'bob', id: 'b', createdUtc: 1790000000, title: '[Hiring] a dev', selftext: '' },
    ] } });
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ name: 'pat', email: 'pat@notarypat.com', website: 'https://notarypat.com', headline: 'Notary in SF' });
    expect(l[0]!.profiles).toHaveLength(2);
  });
  it('runs per subreddit', async () => {
    const m = new FakeMonid().override('anyapi/reddit.subreddit_search', { output: fixture('anyapi__reddit.subreddit_search'), cost: 0.00035 });
    await redditForHire.run(makeCtx({ monid: m, ...sign }));
    expect(m.calls.map((c) => (c.input.body as { subreddit: string }).subreddit)).toEqual(['forhire', 'sanfrancisco', 'bayarea']);
  });
});

describe('registry', () => {
  it('lists the five sources cheapest first', () => {
    expect(peopleSources.map((s) => s.id)).toEqual([
      'monid:litescrape/google/search',
      'monid:anyapi/twitter.search_users',
      'monid:anyapi/reddit.subreddit_search',
      'monid:context.dev/people/search',
      'monid:ploid/linkedin/search',
    ]);
    const costs = peopleSources.map((s) => s.costEstimateUsd);
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
  });
});
