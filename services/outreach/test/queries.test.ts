import { describe, expect, it } from 'vitest';
import { planQueries, planSearch } from '../src/queries.js';

const j = (title: string, instructions = '', cert: string | null = null, extra: Record<string, unknown> = {}) => ({
  title,
  instructions,
  certification_required: cert,
  address: '1 Market St, San Francisco, CA 94105',
  lat: 37.77,
  lng: -122.41,
  remote: false,
  ...extra,
});

describe('planQueries (maps, on-site)', () => {
  it('sign holding -> event staffing', () => {
    expect(planQueries(j('Hold a sign near the YC office'))).toEqual(['event staffing', 'promotional staffing']);
  });
  it('photo / courier / notary / moving / cleaning', () => {
    expect(planQueries(j('Take photos of storefront'))).toEqual(['photographer']);
    expect(planQueries(j('Pickup a package and deliver it'))).toEqual(['courier service']);
    expect(planQueries(j('Notarize a document'))).toEqual(['notary public']);
    expect(planQueries(j('Help lift a couch'))).toEqual(['moving help']);
    expect(planQueries(j('Office cleaning'))).toEqual(['cleaning service']);
  });
  it('defaults to staffing; "design" alone does not match', () => {
    expect(planQueries(j('Do a thing'))).toEqual(['staffing agency', 'temp agency']);
    expect(planQueries(j('Design review'))).toEqual(['staffing agency', 'temp agency']);
  });
  it('adds certification phrase, max 3 total', () => {
    const q = planQueries(j('Photograph and deliver and hold a sign', '', 'Notary Public'));
    expect(q).toHaveLength(3);
    expect(q[2]).toBe('Notary Public');
  });
});

describe('planSearch', () => {
  it('legal review is remote with attorney roles and no maps queries', () => {
    const p = planSearch(j('Review our SaaS terms of service', 'Review this contract for privacy issues', 'California bar license'));
    expect(p.remote).toBe(true);
    expect(p.roles).toEqual(['contract attorney', 'paralegal']);
    expect(p.skills).toEqual(expect.arrayContaining(['SaaS', 'terms of service', 'privacy']));
    expect(p.credential).toBe('California bar license');
    expect(p.mapsQueries).toEqual([]);
    expect(p.locationText).toBeNull();
  });
  it('software: detects the stack', () => {
    const p = planSearch(j('Fix a React bug', 'TypeScript + Next.js app, one failing PR'));
    expect(p.remote).toBe(true);
    expect(p.roles).toEqual(['software engineer']);
    expect(p.skills).toEqual(expect.arrayContaining(['React', 'TypeScript', 'Next.js']));
  });
  it('covers design, writing, translation (language), bookkeeping, video editing, tutoring', () => {
    expect(planSearch(j('Design a logo')).roles).toContain('logo designer');
    expect(planSearch(j('Write a blog post')).roles).toContain('copywriter');
    expect(planSearch(j('Translate a brochure to Spanish')).roles[0]).toBe('Spanish translator');
    expect(planSearch(j('Monthly bookkeeping in QuickBooks')).roles).toContain('bookkeeper');
    expect(planSearch(j('Edit a video for YouTube')).roles).toEqual(['video editor']);
    expect(planSearch(j('Math tutoring for a teen')).roles).toEqual(['tutor']);
  });
  it('on-site: city from address, maps queries, not remote', () => {
    const p = planSearch(j('Hold a sign'));
    expect(p.remote).toBe(false);
    expect(p.locationText).toBe('San Francisco');
    expect(p.mapsQueries).toEqual(['event staffing', 'promotional staffing']);
    expect(p.roles).toContain('brand ambassador');
  });
  it('remote when job has no coordinates or job.remote', () => {
    expect(planSearch(j('Hold a sign', '', null, { lat: null, lng: null })).remote).toBe(true);
    expect(planSearch(j('Hold a sign', '', null, { remote: true })).remote).toBe(true);
  });
  it('hints win', () => {
    const p = planSearch(j('Review our SaaS terms of service'), { remote: false, roles: ['notary public'], skills: ['loan signing'], credential: null });
    expect(p.remote).toBe(false);
    expect(p.roles).toEqual(['notary public']);
    expect(p.skills).toEqual(['loan signing']);
    expect(p.credential).toBeNull();
    expect(p.mapsQueries).toEqual(['notary public']);
  });
});
