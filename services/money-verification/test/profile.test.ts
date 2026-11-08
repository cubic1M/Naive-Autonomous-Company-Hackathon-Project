import { describe, expect, it } from 'vitest';
import { budgetTier, describeProfile, requiredCertification, TIER_RULES, verificationProfile } from '../src/proof/profile.js';
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

  it('a certification_required that means "none" is ignored and noted: the budget decides the tier', () => {
    const negatives = ['none', 'None', 'NO', 'no', 'n/a', 'N/A', 'na', 'nil', 'null', 'false', 'not required', 'Not  Applicable', '-', ' - '];
    for (const value of negatives) {
      const p = verificationProfile(job({ budget_cents: 3000, certification_required: value }));
      expect(p).toMatchObject({ tier: 0, certificationRequired: false, identityRequired: false, minPhotos: 1 });
      expect(p.notes.join(' ')).toContain(`certification_required "${value.trim()}" means none; ignored`);
    }
    const blank = verificationProfile(job({ budget_cents: 3000, certification_required: '   ' }));
    expect(blank).toMatchObject({ tier: 0, certificationRequired: false });
    expect(blank.notes.join(' ')).not.toContain('certification');
    expect(verificationProfile(job({ budget_cents: 3000, certification_required: 'notary' }))).toMatchObject({ tier: 2, certificationRequired: true });
    expect(requiredCertification(' N/A ')).toBeNull();
    expect(requiredCertification(' CA notary public ')).toBe('CA notary public');
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

  it('a risk_class naming an Object.prototype key is ignored and noted too, not looked up on the prototype', () => {
    for (const value of ['constructor', '__proto__', ' Constructor ', 'toString', 'hasOwnProperty']) {
      const p = verificationProfile(job({ budget_cents: 3000, risk_class: value }));
      expect(p).toMatchObject({ tier: 0, minPhotos: 1, confidenceThreshold: 0.8 });
      expect(p.notes.join(' ')).toMatch(/is not low \| standard \| high; ignored/);
    }
  });

  it('required_tier does not move the verification tier: it is the worker-tier gate in check_eligibility', () => {
    expect(verificationProfile(job({ budget_cents: 3000, required_tier: 1 })).tier).toBe(0);
    expect(verificationProfile(job({ budget_cents: 3000, required_tier: 5 }))).toMatchObject({ tier: 0, identityRequired: false, minPhotos: 1 });
    expect(verificationProfile(job({ budget_cents: 30000, required_tier: 0 })).tier).toBe(2);
    expect(verificationProfile(job({ budget_cents: 3000, required_tier: 3 })).notes.join(' ')).not.toContain('required_tier');
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
