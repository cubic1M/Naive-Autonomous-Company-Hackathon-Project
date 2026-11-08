import { describe, expect, it } from 'vitest';
import { budgetTier, describeProfile, TIER_RULES, verificationProfile } from '../src/proof/profile.js';
import type { Job } from '../src/types.js';
import { makeJob } from './helpers.js';

const job = (overrides: Partial<Job> = {}) => makeJob(overrides);

describe('verificationProfile: budget tiers', () => {
  it('tier 0 under $50: one photo, device time fallback, 0.80, no identity', () => {
    const p = verificationProfile(job({ budget_cents: 3000 }));
    expect(p).toMatchObject({
      tier: 0,
      confidenceThreshold: 0.8,
      minPhotos: 1,
      exifTimePolicy: 'device_fallback',
      identityRequired: false,
      certificationRequired: false,
    });
    expect(p.notes.join(' ')).toContain('$30');
  });

  it('tier 1 from $50 to $150 inclusive: EXIF time required, 0.85', () => {
    for (const cents of [5000, 6000, 15000]) {
      expect(verificationProfile(job({ budget_cents: cents }))).toMatchObject({
        tier: 1,
        confidenceThreshold: 0.85,
        minPhotos: 1,
        exifTimePolicy: 'require',
        identityRequired: false,
      });
    }
  });

  it('tier 2 above $150: two photos, 0.90, identity required', () => {
    expect(verificationProfile(job({ budget_cents: 15001 }))).toMatchObject({
      tier: 2,
      confidenceThreshold: 0.9,
      minPhotos: 2,
      exifTimePolicy: 'require',
      identityRequired: true,
    });
    expect(budgetTier(4999)).toBe(0);
    expect(budgetTier(5000)).toBe(1);
    expect(budgetTier(15000)).toBe(1);
    expect(budgetTier(24000)).toBe(2);
  });
});

describe('verificationProfile: certification, risk class, floors, customer requirement', () => {
  it('a notarization job is tier 2 whatever the budget', () => {
    const p = verificationProfile(job({ budget_cents: 6000, task_type: 'notarization' }));
    expect(p).toMatchObject({ tier: 2, certificationRequired: true, identityRequired: true, minPhotos: 2 });
  });

  it('any certification_required lifts the job to tier 2', () => {
    const p = verificationProfile(job({ budget_cents: 6000, certification_required: 'licensed electrician' }));
    expect(p).toMatchObject({ tier: 2, certificationRequired: true });
    expect(p.notes.join(' ')).toContain('licensed electrician');
  });

  it('risk_class overrides the budget tier in both directions', () => {
    expect(verificationProfile(job({ budget_cents: 30000, risk_class: 'low' })).tier).toBe(0);
    expect(verificationProfile(job({ budget_cents: 3000, risk_class: 'high' })).tier).toBe(2);
    expect(verificationProfile(job({ budget_cents: 3000, risk_class: 'standard' })).tier).toBe(1);
    expect(verificationProfile(job({ budget_cents: 30000, risk_class: 'low' })).notes.join(' ')).toMatch(/risk_class low/);
  });

  it('risk_class cannot lower a certification job below tier 2', () => {
    expect(verificationProfile(job({ budget_cents: 6000, task_type: 'notarization', risk_class: 'low' })).tier).toBe(2);
  });

  it('an unknown risk_class is ignored and noted', () => {
    const p = verificationProfile(job({ budget_cents: 3000, risk_class: 'weird' }));
    expect(p.tier).toBe(0);
    expect(p.notes.join(' ')).toMatch(/weird.*ignored/);
  });

  it('required_tier is a floor, clamped to 2, and never lowers', () => {
    expect(verificationProfile(job({ budget_cents: 3000, required_tier: 1 })).tier).toBe(1);
    expect(verificationProfile(job({ budget_cents: 3000, required_tier: 5 })).tier).toBe(2);
    expect(verificationProfile(job({ budget_cents: 30000, required_tier: 0 })).tier).toBe(2);
  });

  it("composes the customer's photo minimum by max", () => {
    expect(verificationProfile(job({ budget_cents: 3000, proof_schema: { photos: { min: 3, must_show: [] } } })).minPhotos).toBe(3);
    expect(verificationProfile(job({ budget_cents: 30000, proof_schema: { photos: { min: 1, must_show: [] } } })).minPhotos).toBe(2);
    expect(verificationProfile(job({ budget_cents: 6000, proof_schema: { photos: { min: 0, must_show: [] } } })).minPhotos).toBe(1);
  });

  it('describeProfile reads as one line of evidence', () => {
    const text = describeProfile(verificationProfile(job({ budget_cents: 30000 })));
    expect(text).toMatch(/^tier 2/);
    expect(text).toContain('0.9');
    expect(text).toContain('2 photo');
    expect(text).toContain('identity');
  });

  it('TIER_RULES is a ladder: each tier is at least as strict as the one below', () => {
    expect(TIER_RULES[0].confidenceThreshold).toBeLessThan(TIER_RULES[1].confidenceThreshold);
    expect(TIER_RULES[1].confidenceThreshold).toBeLessThan(TIER_RULES[2].confidenceThreshold);
    expect(TIER_RULES[2].minPhotos).toBeGreaterThan(TIER_RULES[1].minPhotos);
  });
});
