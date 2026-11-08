import { describe, expect, it } from 'vitest';
import { dedupeKey, mergeLeads } from '../src/dedupe.js';
import type { Lead } from '../src/types.js';

const lead = (o: Partial<Lead> = {}): Lead => ({
  name: 'Acme', kind: 'business', email: null, phone: null, website: null, profile_url: null, address: '1 Main St',
  lat: null, lng: null, source: 'monid:x', source_ref: null, categories: [], rating: null, snippet: null, ...o,
});
const li = (h: string) => ({ platform: 'linkedin' as const, url: `https://www.linkedin.com/in/${h}`, handle: h });
const gh = (h: string) => ({ platform: 'github' as const, url: `https://github.com/${h}`, handle: h });
const xp = (h: string) => ({ platform: 'x' as const, url: `https://x.com/${h}`, handle: h });

describe('dedupeKey', () => {
  it('prefers email, then phone, then source ref, then name+address', () => {
    expect(dedupeKey(lead({ email: 'A@B.com', phone: '(415) 555-0142', source_ref: 'p1' }))).toBe('email:a@b.com');
    expect(dedupeKey(lead({ phone: '(415) 555-0142', source_ref: 'p1' }))).toBe('phone:+14155550142');
    expect(dedupeKey(lead({ source_ref: 'p1' }))).toBe('ref:monid:x:p1');
    expect(dedupeKey(lead({ name: 'Acme, Inc.' }))).toBe('name:acme inc|1 main st');
  });
  it('prefers linkedin > email > github > x > phone', () => {
    const base = { email: 'a@b.com', phone: '+14155550142' };
    expect(dedupeKey(lead({ ...base, profiles: [gh('jd'), xp('jd'), li('jane')] }))).toBe('linkedin:jane');
    expect(dedupeKey(lead({ ...base, profiles: [gh('jd')] }))).toBe('email:a@b.com');
    expect(dedupeKey(lead({ phone: base.phone, profiles: [xp('jd'), gh('jd')] }))).toBe('github:jd');
    expect(dedupeKey(lead({ phone: base.phone, profiles: [xp('jd')] }))).toBe('x:jd');
    expect(dedupeKey(lead({ phone: base.phone, profiles: [{ platform: 'reddit', url: 'https://www.reddit.com/user/Jd', handle: 'Jd' }] }))).toBe('reddit:Jd');
  });
  it('uses profile_url when it is a profile, ignores Maps links', () => {
    expect(dedupeKey(lead({ profile_url: 'https://linkedin.com/in/Jane?x=1' }))).toBe('linkedin:jane');
    expect(dedupeKey(lead({ profile_url: 'https://www.google.com/maps/place/x', source_ref: 'p9' }))).toBe('ref:monid:x:p9');
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
  });
  it('same LinkedIn handle from two sources is one person; unions profiles/credentials/open_to_work, keeps best headline', () => {
    const person = (o: Partial<Lead>) => lead({ kind: 'person', address: null, ...o });
    const out = mergeLeads([
      person({ name: 'Jane D', source: 'monid:google', profiles: [li('jane')], headline: 'Attorney', credentials: ['CA Bar'], last_active_at: '2026-01-01T00:00:00Z' }),
      person({ name: 'Jane Doe', source: 'monid:linkedin', profiles: [li('jane'), gh('janed')], headline: 'Freelance contract attorney | SaaS', open_to_work: true, last_active_at: '2026-03-01T00:00:00Z' }),
      person({ name: 'Jane (gh)', source: 'monid:gh', profiles: [gh('janed')], credentials: ['Notary'] }),
      person({ name: 'Someone Else', profiles: [li('other')] }),
    ]);
    expect(out).toHaveLength(2);
    const jane = out[0]!;
    expect(jane.headline).toBe('Freelance contract attorney | SaaS');
    expect(jane.open_to_work).toBe(true);
    expect(jane.credentials).toEqual(['CA Bar', 'Notary']);
    expect(jane.profiles!.map((x) => x.platform).sort()).toEqual(['github', 'linkedin']);
    expect(jane.last_active_at).toBe('2026-03-01T00:00:00Z');
  });
  it('merges on website host and on name + location_text; ignores shared hosts', () => {
    const person = (o: Partial<Lead>) => lead({ kind: 'person', address: null, ...o });
    expect(mergeLeads([person({ name: 'A', website: 'https://jane.design' }), person({ name: 'B', website: 'https://www.jane.design/about' })])).toHaveLength(1);
    expect(mergeLeads([person({ name: 'Jane Doe', location_text: 'Austin, TX' }), person({ name: 'jane doe', location_text: 'Austin TX' })])).toHaveLength(1);
    expect(mergeLeads([person({ name: 'A', website: 'https://instagram.com/a' }), person({ name: 'B', website: 'https://instagram.com/b' })])).toHaveLength(2);
    expect(mergeLeads([person({ name: 'Jane Doe' }), person({ name: 'Jane Doe' })])).toHaveLength(2); // no location: not enough to merge people
  });
});
