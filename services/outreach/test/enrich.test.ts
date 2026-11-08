import { describe, expect, it } from 'vitest';
import { githubProfile, instagramContact, linkedinWorkEmail, makeGithubProfile, personEnrichers, websiteContact, xBio } from '../src/enrich/index.js';
import { acceptableEmail, buildPresenceQuery, pickOwnSite, webPresence } from '../src/enrich/webPresence.js';
import type { Lead } from '../src/types.js';
import { FakeMonid, fixture } from './helpers/fakeMonid.js';

const lead = (o: Partial<Lead> = {}): Lead => ({
  name: 'Jane', kind: 'person', email: null, phone: null, website: null, profile_url: null, address: null, lat: null, lng: null,
  source: 't', source_ref: null, categories: [], rating: null, snippet: null, profiles: [], ...o,
});
const prof = (platform: any, url: string, handle?: string) => ({ platform, url, handle: handle ?? null });

describe('personEnrichers', () => {
  it('is ordered cheapest first and never includes a personal-email product', () => {
    const costs = personEnrichers.map((e) => e.costEstimateUsd);
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
    expect(personEnrichers.every((e) => typeof e.applies === 'function')).toBe(true);
    expect(personEnrichers.map((e) => e.id).join(' ')).not.toMatch(/personal/);
  });
});

describe('githubProfile', () => {
  const okFetch = (body: unknown, status = 200, calls: { url: string; headers?: Record<string, string> }[] = []) =>
    async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, headers: init?.headers });
      return { ok: status < 400, status, json: async () => body };
    };

  it('applies only with a github profile', () => {
    expect(githubProfile.applies!(lead())).toBe(false);
    expect(githubProfile.applies!(lead({ profiles: [prof('github', 'https://github.com/octocat', 'octocat')] }))).toBe(true);
    expect(githubProfile.applies!(lead({ profile_url: 'https://github.com/octocat' }))).toBe(true);
  });
  it('maps email, blog, twitter, hireable, location, bio; sends a User-Agent; free', async () => {
    const calls: { url: string; headers?: Record<string, string> }[] = [];
    const e = makeGithubProfile(okFetch(fixture('github__users_octocat'), 200, calls));
    const r = await e.enrich(lead({ profiles: [prof('github', 'https://github.com/octocat', 'octocat')] }), new FakeMonid());
    expect(calls[0]!.url).toBe('https://api.github.com/users/octocat');
    expect(calls[0]!.headers?.['User-Agent']).toBe('operis-outreach');
    expect(r.email).toBe('octocat@github.com');
    expect(r.cost_usd).toBe(0);
    expect(r.profiles).toEqual([
      { platform: 'website', url: 'https://github.blog', handle: null },
      { platform: 'x', url: 'https://x.com/github', handle: 'github' },
    ]);
    expect(r).toMatchObject({ open_to_work: true, location_text: 'San Francisco', headline: 'Mascot. Writes a lot of open source TypeScript.' });
  });
  it('404 is empty, other errors throw, bad login makes no call', async () => {
    const lg = lead({ profiles: [prof('github', 'https://github.com/ghost', 'ghost')] });
    expect((await makeGithubProfile(okFetch({}, 404)).enrich(lg, new FakeMonid())).email).toBeNull();
    await expect(makeGithubProfile(okFetch({}, 403)).enrich(lg, new FakeMonid())).rejects.toThrow(/403/);
    const calls: any[] = [];
    await makeGithubProfile(okFetch({}, 200, calls)).enrich(lead({ profiles: [prof('github', 'https://github.com/a', 'a/../b')] }), new FakeMonid());
    expect(calls).toHaveLength(0);
  });
  it('null email/hireable do not produce junk', async () => {
    const r = await makeGithubProfile(okFetch({ login: 'x', email: null, blog: '', twitter_username: null, hireable: null, location: null, bio: null })).enrich(
      lead({ profiles: [prof('github', 'https://github.com/x', 'x')] }),
      new FakeMonid(),
    );
    expect(r).toMatchObject({ email: null, profiles: [], open_to_work: false, location_text: null, headline: null });
  });
});

describe('xBio', () => {
  const l = lead({ profiles: [prof('x', 'https://x.com/jack', 'jack')] });
  it('applies to x profiles without an email', () => {
    expect(xBio.applies!(l)).toBe(true);
    expect(xBio.applies!(lead({ email: 'a@b.co', profiles: l.profiles }))).toBe(false);
    expect(xBio.applies!(lead())).toBe(false);
  });
  it('real fixture (bio without contact) costs $0.00025 and finds nothing', async () => {
    const m = new FakeMonid().override('twitterdata.io/users', { output: fixture('twitterdata.io__users'), cost: 0.00025 });
    const r = await xBio.enrich(l, m);
    expect(m.calls[0]!.input).toEqual({ queryParams: { username: 'jack' } });
    expect(r.email).toBeNull();
    expect(r.cost_usd).toBeCloseTo(0.00025);
    expect(r.headline).toBe('no state is the best state');
  });
  it('extracts email (incl. obfuscated) and linked profiles from the bio', async () => {
    const out = { data: { username: 'jane', bio: 'Contract attorney. hire me: jane [at] acmelaw [dot] com\nhttps://www.linkedin.com/in/jane-doe https://janedoe.com/' } };
    const m = new FakeMonid().override('twitterdata.io/users', { output: out, cost: 0.00025 });
    const r = await xBio.enrich(lead({ profiles: [prof('x', 'https://x.com/jane', 'jane')] }), m);
    expect(r.email).toBe('jane@acmelaw.com');
    expect(r.profiles!.map((p) => p.platform).sort()).toEqual(['linkedin', 'website']);
  });
  it('unknown handle (404) is empty, not an error', async () => {
    const m = new FakeMonid().override('twitterdata.io/users', { error: 'not_found' });
    // FakeMonid error => status 500 => SourceError; real 404s carry http 404
    await expect(xBio.enrich(l, m)).rejects.toThrow();
    const m404 = { run: async () => ({ runId: 'r', status: 'FAILED' as const, httpStatus: 404, output: null, cost_usd: 0 }) };
    expect((await xBio.enrich(l, m404)).email).toBeNull();
  });
});

describe('instagramContact', () => {
  const l = lead({ profiles: [prof('instagram', 'https://www.instagram.com/eminenceorganics', 'eminenceorganics')] });
  it('reads the public contact email/phone from the real fixture', async () => {
    const m = new FakeMonid().override('anyapi/instagram.profile_contact', { output: fixture('anyapi__instagram.profile_contact'), cost: 0.00175 });
    const r = await instagramContact.enrich(l, m);
    expect(m.calls[0]!.input).toEqual({ body: { handle: 'eminenceorganics' } });
    expect(r.email).toBe('info@eminenceorganics.com');
    expect(r.phone).toBe('+18887476342');
    expect(r.cost_usd).toBeCloseTo(0.00175);
  });
  it('found:false is empty; applies needs an instagram profile', async () => {
    const m = new FakeMonid().override('anyapi/instagram.profile_contact', { output: { found: false } });
    expect((await instagramContact.enrich(l, m)).email).toBeNull();
    expect(instagramContact.applies!(lead())).toBe(false);
    expect(instagramContact.applies!(l)).toBe(true);
  });
});

describe('websiteContact', () => {
  const site = lead({ profiles: [prof('website', 'https://janedoe.com')] });
  const page = (content: string) => ({ results: { content } });
  it('applies to a website profile or lead.website, not to social hosts', () => {
    expect(websiteContact.applies!(site)).toBe(true);
    expect(websiteContact.applies!(lead({ website: 'https://janedoe.com' }))).toBe(true);
    expect(websiteContact.applies!(lead({ website: 'https://www.instagram.com/x' }))).toBe(false);
    expect(websiteContact.applies!(lead())).toBe(false);
    expect(websiteContact.applies!(lead({ ...site, email: 'a@b.co' }))).toBe(false);
  });
  it('crawls home then /contact, prefers own-domain email, stops at first hit', async () => {
    let n = 0;
    const m = new FakeMonid().override('search1api/crawl', (i) => {
      n++;
      return page(n === 1 ? 'Welcome. Call (415) 555-0142' : 'Email me: jane@janedoe.com or other@gmail.com');
    });
    const r = await websiteContact.enrich(site, m);
    expect(m.calls.map((c) => (c.input.body as any).url)).toEqual(['https://janedoe.com', 'https://janedoe.com/contact']);
    expect(r.email).toBe('jane@janedoe.com');
    expect(r.phone).toBe('+14155550142');
    expect(r.cost_usd).toBeCloseTo(0.002);
  });
  it('tries /about too and returns nothing when no page has an email', async () => {
    const m = new FakeMonid().override('search1api/crawl', { output: page('no contact here'), cost: 0.001 });
    const r = await websiteContact.enrich(site, m);
    expect(m.calls).toHaveLength(3);
    expect(m.calls[2]!.input.body).toEqual({ url: 'https://janedoe.com/about' });
    expect(r.email).toBeNull();
    expect(r.cost_usd).toBeCloseTo(0.003);
  });
});

describe('linkedinWorkEmail', () => {
  const l = lead({
    profiles: [prof('linkedin', 'https://www.linkedin.com/in/example-person', 'example-person'), prof('website', 'https://acmelaw.com')],
  });
  it('is the expensive last resort: applies only to linkedin + own website without an email', () => {
    expect(linkedinWorkEmail.costEstimateUsd).toBe(0.1);
    expect(linkedinWorkEmail.applies!(l)).toBe(true);
    expect(linkedinWorkEmail.applies!(lead({ profiles: [prof('linkedin', 'https://www.linkedin.com/in/x', 'x')] }))).toBe(false);
    expect(linkedinWorkEmail.applies!(lead({ ...l, email: 'a@b.co' }))).toBe(false);
    expect(linkedinWorkEmail.applies!(lead())).toBe(false);
  });
  it('returns the work email only (fixture hand-written from docs)', async () => {
    const m = new FakeMonid().override('contactout/v1/people/linkedin/work-email', { output: fixture('contactout__v1_people_linkedin_work-email'), cost: 0.1 });
    const r = await linkedinWorkEmail.enrich(l, m);
    expect(m.calls[0]!.input).toEqual({ queryParams: { profile: 'https://www.linkedin.com/in/example-person' } });
    expect(r.email).toBe('jane@acmelaw.com');
    expect(r.cost_usd).toBeCloseTo(0.1);
  });
  it('drops an employer email that is not on the person\'s own domain', async () => {
    const m = new FakeMonid().override('contactout/v1/people/linkedin/work-email', { output: { profile: { work_email: ['priya@oracle.com'] } }, cost: 0.1 });
    expect((await linkedinWorkEmail.enrich(l, m)).email).toBeNull();
  });
  it('ignores personal emails and treats a 404 miss as free/empty', async () => {
    const m = new FakeMonid().override('contactout/v1/people/linkedin/work-email', { output: { profile: { work_email: [], personal_email: ['me@gmail.com'], email: ['me@gmail.com'] } } });
    expect((await linkedinWorkEmail.enrich(l, m)).email).toBeNull();
    const m404 = { run: async () => ({ runId: 'r', status: 'FAILED' as const, httpStatus: 404, output: null, cost_usd: 0 }) };
    expect(await linkedinWorkEmail.enrich(l, m404)).toMatchObject({ email: null, cost_usd: 0 });
  });
});

describe('webPresence', () => {
  const named = lead({ name: 'Leslie Werner', headline: 'Contract attorney', profiles: [prof('linkedin', 'https://www.linkedin.com/in/lw', 'lw')] });
  const search = fixture('litescrape__google_search_name');

  it('is registered before linkedin, after website', () => {
    const ids = personEnrichers.map((e) => e.id);
    expect(ids.indexOf(webPresence.id)).toBe(ids.indexOf(websiteContact.id) + 1);
    expect(ids.indexOf(webPresence.id)).toBeLessThan(ids.indexOf(linkedinWorkEmail.id));
  });
  it('builds the lookup query', () => {
    expect(buildPresenceQuery(named)).toBe('"Leslie Werner" attorney (contact OR email) -site:linkedin.com');
    expect(buildPresenceQuery({ ...named, name: 'Madonna' })).toBeNull();
    expect(buildPresenceQuery({ ...named, name: 'Acme Legal LLC' })).toBeNull();
  });
  it('applies to named people without email or own site', () => {
    expect(webPresence.applies!(named)).toBe(true);
    expect(webPresence.applies!({ ...named, email: 'a@b.co' })).toBe(false);
    expect(webPresence.applies!({ ...named, profiles: [prof('website', 'https://wernerlaw.com')] })).toBe(false); // own site already known
    expect(webPresence.applies!({ ...named, profiles: [prof('website', 'https://californiaattorneyregistry.com')] })).toBe(true); // a directory is not their site
    expect(webPresence.applies!(lead({ name: null }))).toBe(false);
  });
  it('picks the person\'s own site/directory page from a real result list, skipping social and aggregators', () => {
    const p = pickOwnSite(search, 'Leslie Werner');
    expect(p).not.toBeNull();
    expect(['website', 'directory']).toContain(p!.platform);
    expect(p!.url).not.toMatch(/facebook|zoominfo|linkedin/);
    expect(pickOwnSite(search, 'Zed Nobody')).toBeNull();
  });
  it('accepts only own-domain or generic-mailbox emails', () => {
    expect(acceptableEmail('les@lawfirm.com', 'lawfirm.com')).toBe(true);
    expect(acceptableEmail('les@gmail.com', 'lawfirm.com')).toBe(true);
    expect(acceptableEmail('webmaster@wix.com', 'lawfirm.com')).toBe(false);
  });
  it('searches once, crawls the found site, returns an own-domain email and the website profile', async () => {
    const m = new FakeMonid()
      .override('litescrape/google/search', { output: { organic_results: [
        { title: 'Leslie Werner, Attorney', link: 'https://lesliewerner.law/about/', snippet: 'Contract law' },
      ] }, cost: 0.00015 })
      .override('search1api/crawl', (i) => ({ results: { content: (i.body as any).url.endsWith('/contact') ? 'Reach me: leslie@lesliewerner.law, host: support@wix.com' : 'Hello' } }));
    const r = await webPresence.enrich(named, m);
    expect(m.callsTo('litescrape/google/search')).toBe(1);
    expect(r.email).toBe('leslie@lesliewerner.law');
    expect(r.profiles).toEqual([{ platform: 'website', url: 'https://lesliewerner.law', handle: null }]);
    expect(r.cost_usd).toBeCloseTo(0.00015 + 0.002, 6);
  });
  it('rejects foreign-domain emails and costs only the search when no site matches', async () => {
    const m = new FakeMonid()
      .override('litescrape/google/search', { output: { organic_results: [{ title: 'Leslie Werner', link: 'https://lesliewerner.law', snippet: '' }] }, cost: 0.00015 })
      .override('search1api/crawl', { output: { results: { content: 'built by agency: hi@agency.io' } }, cost: 0.001 });
    const r = await webPresence.enrich(named, m);
    expect(r.email).toBeNull();
    expect(r.profiles).toHaveLength(1);
    const none = new FakeMonid().override('litescrape/google/search', { output: { organic_results: [] }, cost: 0.00015 });
    const r2 = await webPresence.enrich(named, none);
    expect(r2).toMatchObject({ email: null, cost_usd: 0.00015 });
    expect(none.callsTo('search1api/crawl')).toBe(0);
  });
});

describe('isOwnSiteFor', () => {
  it('accepts a person\'s own domain, rejects directories and unrelated sites', async () => {
    const { isOwnSiteFor } = await import('../src/enrich/util.js');
    const robert = { name: 'Robert M. Congelliere', kind: 'person' as const };
    expect(isOwnSiteFor('https://congellierelaw.com', robert)).toBe(true);
    expect(isOwnSiteFor('https://www.californiaattorneyregistry.com/robert-congelliere', robert)).toBe(false);
    expect(isOwnSiteFor('https://acme-legal.com', robert)).toBe(false);
    expect(isOwnSiteFor('https://isaihowens.dev', { name: 'Isaih Owens, Esq.', kind: 'person' })).toBe(true);
    expect(isOwnSiteFor('https://kineticevents.com', { name: 'Kinetic Events Staffing', kind: 'business' })).toBe(true);
    expect(isOwnSiteFor('https://www.yelp.com/biz/x', { name: 'X', kind: 'business' })).toBe(false);
  });
});
