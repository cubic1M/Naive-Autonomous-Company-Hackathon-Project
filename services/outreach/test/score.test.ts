import { describe, expect, it } from 'vitest';
import { contactability, hasCredential, locationMatches, scorePerson, type ScoreContext, type Scorable } from '../src/score.js';

const job = { lat: 37.7749, lng: -122.4194 };
const now = new Date('2026-06-01T00:00:00Z');
const onsite: ScoreContext = { radiusKm: 8, roles: ['event staffing'], remote: false, locationText: 'San Francisco', now };
const remote: ScoreContext = { radiusKm: 8, roles: ['contract attorney'], skills: ['SaaS'], remote: true, now };
const p = (o: Partial<Scorable> = {}): Scorable => ({
  name: 'X', lat: 37.7749, lng: -122.4194, categories: ['Event staffing'], snippet: null, rating: null,
  regular: false, email: 'a@b.com', phone: null, sms_consent: false, opted_out: false, kind: 'person', ...o,
});
const lawyer = (o: Partial<Scorable> = {}): Scorable =>
  p({ lat: null, lng: null, categories: [], headline: 'Freelance contract attorney | SaaS', credentials: ['California Bar'], ...o });

describe('scorePerson', () => {
  it('stays within 0..1 and opted out is 0', () => {
    expect(scorePerson(p({ regular: true }), job, onsite)).toBeLessThanOrEqual(1);
    expect(scorePerson(p({ opted_out: true }), job, onsite)).toBe(0);
  });
  it('on-site: distance decays and matters', () => {
    const near = scorePerson(p(), job, onsite);
    const far = scorePerson(p({ lat: 37.7749 + 0.09 }), job, onsite);
    expect(near).toBeGreaterThan(far);
  });
  it('remote: distance is ignored entirely', () => {
    const a = scorePerson(lawyer({ lat: 37.7749, lng: -122.4194 }), job, remote);
    const b = scorePerson(lawyer({ lat: 51.5, lng: -0.12 }), job, remote);
    expect(a).toBeCloseTo(b, 10);
  });
  it('role match is the strongest signal', () => {
    const match = scorePerson(lawyer(), job, remote);
    const miss = scorePerson(lawyer({ headline: 'Baker' }), job, remote);
    expect(match - miss).toBeGreaterThan(0.25);
  });
  it('contactability: email > manual DM > none', () => {
    const dm = { profiles: [{ platform: 'linkedin' as const, url: 'https://www.linkedin.com/in/a' }] };
    expect(contactability({ ...p(), ...dm })).toBe(1);
    expect(contactability({ ...p({ email: null }), ...dm })).toBe(0.6);
    expect(contactability(p({ email: null }))).toBe(0);
    const e = scorePerson(lawyer(), job, remote);
    const m = scorePerson(lawyer({ email: null, ...dm }), job, remote);
    const n = scorePerson(lawyer({ email: null }), job, remote);
    expect(e).toBeGreaterThan(m);
    expect(m).toBeGreaterThan(n);
  });
  it('open_to_work and recency boost', () => {
    const base = scorePerson(lawyer(), job, remote);
    expect(scorePerson(lawyer({ open_to_work: true }), job, remote)).toBeGreaterThan(base);
    expect(scorePerson(lawyer({ last_active_at: '2026-05-20T00:00:00Z' }), job, remote)).toBeGreaterThan(base);
    expect(scorePerson(lawyer({ last_active_at: '2020-01-01T00:00:00Z' }), job, remote)).toBeCloseTo(base, 10);
  });
  it('credential required: present boosts, absent penalizes strongly', () => {
    const ctx = { ...remote, credential: 'California bar license' };
    const has = scorePerson(lawyer(), job, ctx);
    const lacks = scorePerson(lawyer({ credentials: [] }), job, ctx);
    expect(has - lacks).toBeGreaterThan(0.4);
    expect(has).toBeGreaterThan(scorePerson(lawyer(), job, remote));
    expect(lacks).toBeLessThan(scorePerson(lawyer({ credentials: [] }), job, remote));
  });
  it('businesses rank below equivalent individuals', () => {
    expect(scorePerson(p({ kind: 'business' }), job, onsite)).toBeLessThan(scorePerson(p(), job, onsite));
  });
  it('regular bonus', () => {
    const base = p({ lat: 37.8, categories: [] });
    expect(scorePerson({ ...base, regular: true }, job, onsite)).toBeGreaterThan(scorePerson(base, job, onsite) + 0.25);
  });
  it('on-site: no coordinates is neutral, location text match helps', () => {
    const noLoc = scorePerson(p({ lat: null, lng: null }), job, onsite);
    const inCity = scorePerson(p({ lat: null, lng: null, location_text: 'San Francisco Bay Area' }), job, onsite);
    const near = scorePerson(p(), job, onsite);
    expect(inCity).toBeGreaterThan(noLoc);
    expect(near).toBeGreaterThan(inCity);
  });
});

describe('helpers', () => {
  it('hasCredential ignores noise words', () => {
    expect(hasCredential(lawyer(), 'California bar license')).toBe(true);
    expect(hasCredential(lawyer({ credentials: ['Texas Bar'] }), 'California bar license')).toBe(false);
  });
  it('locationMatches', () => {
    expect(locationMatches('San Francisco Bay Area', 'San Francisco')).toBe(true);
    expect(locationMatches('Bay Area', 'San Francisco')).toBe(true);
    expect(locationMatches('Austin, TX', 'San Francisco')).toBe(false);
  });
});
