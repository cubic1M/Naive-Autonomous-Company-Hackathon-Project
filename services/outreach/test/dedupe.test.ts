import { describe, expect, it } from 'vitest';
import { dedupeKey, mergeLeads } from '../src/dedupe.js';
import type { Lead } from '../src/types.js';

const lead = (o: Partial<Lead> = {}): Lead => ({
  name: 'Acme', kind: 'business', email: null, phone: null, website: null, profile_url: null, address: '1 Main St',
  lat: null, lng: null, source: 'monid:x', source_ref: null, categories: [], rating: null, snippet: null, ...o,
});

describe('dedupeKey', () => {
  it('prefers email, then phone, then source ref, then name+address', () => {
    expect(dedupeKey(lead({ email: 'A@B.com', phone: '(415) 555-0142', source_ref: 'p1' }))).toBe('email:a@b.com');
    expect(dedupeKey(lead({ phone: '(415) 555-0142', source_ref: 'p1' }))).toBe('phone:+14155550142');
    expect(dedupeKey(lead({ source_ref: 'p1' }))).toBe('ref:monid:x:p1');
    expect(dedupeKey(lead({ name: 'Acme, Inc.' }))).toBe('name:acme inc|1 main st');
  });
});

describe('mergeLeads', () => {
  it('merges by shared phone and unions fields', () => {
    const out = mergeLeads([
      lead({ phone: '+14155550142', categories: ['a'], source_ref: 'p1' }),
      lead({ phone: '+14155550142', categories: ['b'], website: 'https://acme.com', source: 'monid:y', source_ref: 'q9' }),
      lead({ name: 'Other', address: 'x', phone: '+14155550999' }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.categories).toEqual(['a', 'b']);
    expect(out[0]!.website).toBe('https://acme.com');
  });
  it('merges transitively (email-only + phone-only + both)', () => {
    const out = mergeLeads([
      lead({ name: 'A', address: 'a1', email: 'a@x.com' }),
      lead({ name: 'B', address: 'b1', phone: '+14155550142' }),
      lead({ name: 'C', address: 'c1', email: 'a@x.com', phone: '+14155550142' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.email).toBe('a@x.com');
    expect(out[0]!.phone).toBe('+14155550142');
  });
});
