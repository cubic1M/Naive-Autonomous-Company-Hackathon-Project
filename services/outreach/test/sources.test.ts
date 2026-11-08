import { describe, expect, it } from 'vitest';
import { crawl, extractEmails } from '../src/sources/crawl.js';
import { googleMaps, parseGoogleMaps } from '../src/sources/googleMaps.js';
import { hunter, pickHunterEmail } from '../src/sources/hunter.js';
import { linkedin, parseLinkedin } from '../src/sources/linkedin.js';
import { mapsNearby, parseMapsNearby } from '../src/sources/mapsNearby.js';
import { SourceError } from '../src/sources/types.js';
import { FakeMonid, fixture, makeCtx, makeJob } from './helpers/fakeMonid.js';

const base = { website: 'https://kineticevents.com', name: 'K', kind: 'business' as const, email: null, phone: null, profile_url: null, address: null, lat: null, lng: null, source: 's', source_ref: null, categories: [], rating: null, snippet: null };

describe('google maps', () => {
  it('parses the fixture', () => {
    const leads = parseGoogleMaps(fixture('litescrape__google_maps'));
    expect(leads).toHaveLength(10);
    const k = leads[0]!;
    expect(k.name).toBe('Kinetic Events Staffing');
    expect(k.phone).toBe('+18883514126');
    expect(k.website).toBe('https://kineticevents.com');
    expect(k.lat).toBeCloseTo(37.784, 2);
    expect(k.source_ref).toBe('ChIJp_mzSX2AhYARGhtUhxWC-kw');
    expect(k.categories).toContain('Temp agency');
    expect(k.source).toBe('monid:litescrape/google/maps');
    expect(leads.find((l) => l.name === 'Leads Event Staffing')!.website).toBeNull();
  });
  it('calls once per query with ll param', async () => {
    const m = new FakeMonid();
    const r = await googleMaps.run(makeCtx({ job: makeJob(), monid: m, queries: ['a', 'b'] }));
    expect(m.calls).toHaveLength(2);
    expect(m.calls[0]!.input.queryParams).toEqual({ q: 'a', type: 'search', ll: '@37.7749,-122.4194,13z' });
    expect(r.leads).toHaveLength(20);
    expect(r.cost_usd).toBeCloseTo(0.0003, 6);
  });
  it('throws SourceError when all calls fail', async () => {
    const m = new FakeMonid().override('litescrape/google/maps', { error: 'boom' });
    await expect(googleMaps.run(makeCtx({ job: makeJob(), monid: m, queries: ['a'] }))).rejects.toBeInstanceOf(SourceError);
  });
});

describe('maps nearby', () => {
  it('parses the fixture', () => {
    const leads = parseMapsNearby(fixture('anyapi__maps.search_nearby'));
    expect(leads).toHaveLength(20);
    expect(leads[0]!.name).toBe('Slava Blazer Photography');
    expect(leads[0]!.phone).toBe('+14152696347');
    expect(leads[0]!.lat).toBeCloseTo(37.7179, 3);
    expect(leads.find((l) => l.name === 'Emily Jenks Photography')!.phone).toBeNull();
  });
  it('parses string lat/lng/rating', () => {
    const l = parseMapsNearby({ data: { items: [{ name: 'A', latitude: '37.5', longitude: '-122.1', rating: '4.5', placeId: 'p' }] } });
    expect(l[0]).toMatchObject({ lat: 37.5, lng: -122.1, rating: 4.5, source_ref: 'p' });
  });
  it('sends the documented body', async () => {
    const m = new FakeMonid();
    await mapsNearby.run(makeCtx({ job: makeJob(), monid: m, queries: ['photographer'] }));
    expect(m.calls[0]!.input.body).toEqual({ query: 'photographer', coordinates: { latitude: 37.7749, longitude: -122.4194 } });
  });
});

describe('hunter', () => {
  it('skips generated/inferred rows (the whole fixture)', async () => {
    expect(pickHunterEmail(fixture('hunterio__domain-search'))).toBeNull();
    const m = new FakeMonid();
    const r = await hunter.enrich({ ...base }, m);
    expect(r.email).toBeNull();
    expect(m.calls[0]!.input.body).toEqual({ domain: 'kineticevents.com', limit: 5 });
    expect(r.cost_usd).toBeCloseTo(0.0245);
  });
  it('prefers published role addresses', () => {
    const out = { data: { emails: [
      { value: 'brian@x.com', type: 'personal', confidence: 99, sources: [{}] },
      { value: 'info@x.com', type: 'generic', confidence: 80, sources: [{}] },
      { value: 'jobs@x.com', type: 'generic', confidence: 99, source_type: 'generated', provenance: 'inferred' },
    ] } };
    expect(pickHunterEmail(out)).toBe('info@x.com');
  });
  it('does not call for social domains', async () => {
    const m = new FakeMonid();
    await hunter.enrich({ ...base, website: 'https://www.facebook.com/x' }, m);
    expect(m.calls).toHaveLength(0);
  });
});

describe('crawl', () => {
  it('extracts phone from the fixture, no bogus email', async () => {
    const m = new FakeMonid();
    const r = await crawl.enrich({ ...base }, m);
    expect(r.phone).toBe('+18883514126');
    expect(r.email).toBeNull();
    expect(m.calls[0]!.input.body).toEqual({ url: 'https://kineticevents.com' });
  });
  it('filters junk emails and prefers role addresses', () => {
    const md = 'a@2x.png b@example.com x@sentry.io y@wixpress.com bob@acme.com Info@Acme.com';
    expect(extractEmails(md)).toEqual(['bob@acme.com', 'info@acme.com']);
  });
  it('picks role email via enrich', async () => {
    const m = new FakeMonid().override('search1api/crawl', { output: { results: { content: 'mail bob@acme.com or info@acme.com call 415-555-0199' } } });
    const r = await crawl.enrich({ ...base, website: 'https://acme.com' }, m);
    expect(r).toMatchObject({ email: 'info@acme.com', phone: '+14155550199' });
  });
});

describe('linkedin', () => {
  it('parses the fixture as person w/o contact', () => {
    const l = parseLinkedin(fixture('ploid__linkedin_search'));
    expect(l[0]).toMatchObject({ kind: 'person', email: null, phone: null, profile_url: 'https://linkedin.com/in/notary-public-a9540934' });
  });
  it('always sends limit <= 5 and the certification keyword', async () => {
    const m = new FakeMonid();
    await linkedin.run(makeCtx({ job: makeJob({ certification_required: 'notary' }), monid: m, queries: [] }));
    expect(m.calls[0]!.input.body).toEqual({ filters: { keywords: 'notary', location: 'San Francisco' }, limit: 5 });
  });
});

describe('crawl contact pages', () => {
  const lead = {
    name: 'Acme', kind: 'business' as const, email: null, phone: null, website: 'https://acme-staffing.com/?utm=x',
    profile_url: null, address: null, lat: null, lng: null, source: 's', source_ref: null, categories: [], rating: null, snippet: null,
  };
  function pageMonid(pages: Record<string, string | 'fail'>) {
    const urls: string[] = [];
    const monid = {
      async run(_p: string, _e: string, input: { body?: Record<string, unknown> }) {
        const url = String(input.body?.url);
        urls.push(url);
        const page = pages[url];
        if (page === 'fail') return { runId: 'x', status: 'COMPLETED' as const, httpStatus: 502, output: null, cost_usd: 0 };
        return { runId: 'x', status: 'COMPLETED' as const, httpStatus: 200, output: { results: { content: page ?? '' } }, cost_usd: 0.001 };
      },
    };
    return { monid, urls };
  }

  it('finds the email on /contact when the homepage has none', async () => {
    const { monid, urls } = pageMonid({ 'https://acme-staffing.com': 'Welcome!', 'https://acme-staffing.com/contact': 'Email jobs@acme-staffing.com' });
    const r = await crawl.enrich(lead, monid);
    expect(r.email).toBe('jobs@acme-staffing.com');
    expect(urls).toEqual(['https://acme-staffing.com', 'https://acme-staffing.com/contact']);
    expect(r.cost_usd).toBeCloseTo(0.002);
  });

  it('skips a failing page and keeps going', async () => {
    const { monid } = pageMonid({ 'https://acme-staffing.com': 'fail', 'https://acme-staffing.com/contact': 'fail', 'https://acme-staffing.com/contact-us': 'hello@acme-staffing.com' });
    const r = await crawl.enrich(lead, monid);
    expect(r.email).toBe('hello@acme-staffing.com');
  });
});
