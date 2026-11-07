import { describe, expect, it } from 'vitest';
import { scorePerson, type Scorable } from '../src/score.js';

const job = { lat: 37.7749, lng: -122.4194 };
const ctx = { radiusKm: 8, queries: ['event staffing'] };
const p = (o: Partial<Scorable> = {}): Scorable => ({
  name: 'X', lat: 37.7749, lng: -122.4194, categories: ['Event staffing'], snippet: null, rating: 5,
  regular: false, email: 'a@b.com', phone: null, sms_consent: false, opted_out: false, ...o,
});

describe('scorePerson', () => {
  it('is within 0..1 and top for the perfect nearby match', () => {
    expect(scorePerson(p(), job, ctx)).toBeCloseTo(1, 5);
  });
  it('distance decays to zero at radius', () => {
    const near = scorePerson(p({ lat: 37.78 }), job, ctx);
    const far = scorePerson(p({ lat: 37.7749 + 0.09 }), job, ctx); // ~10 km
    expect(near).toBeGreaterThan(far);
    const atRadius = scorePerson(p({ lat: 37.7749 + 8 / 111.19, categories: [], rating: null, email: null }), job, ctx);
    expect(atRadius).toBeLessThan(0.01);
  });
  it('regular bonus +0.3 capped at 1', () => {
    const base = p({ lat: 37.8, categories: [], rating: null });
    const reg = scorePerson({ ...base, regular: true }, job, ctx);
    expect(reg - scorePerson(base, job, ctx)).toBeCloseTo(0.3, 5);
    expect(scorePerson(p({ regular: true }), job, ctx)).toBe(1);
  });
  it('keyword matches partially and fully', () => {
    const none = scorePerson(p({ categories: ['Bakery'] }), job, ctx);
    const part = scorePerson(p({ categories: ['Staffing agency'] }), job, ctx);
    const full = scorePerson(p({ categories: ['Event staffing'] }), job, ctx);
    expect(none).toBeLessThan(part);
    expect(part).toBeLessThan(full);
  });
  it('rating and channel contribute', () => {
    expect(scorePerson(p({ rating: 3 }), job, ctx)).toBeLessThan(scorePerson(p({ rating: 5 }), job, ctx));
    expect(scorePerson(p({ email: null }), job, ctx)).toBeLessThan(scorePerson(p(), job, ctx));
  });
  it('unknown location is neutral, opted out is 0', () => {
    const s = scorePerson(p({ lat: null, lng: null }), job, ctx);
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThan(1);
    expect(scorePerson(p({ opted_out: true }), job, ctx)).toBe(0);
  });
});
