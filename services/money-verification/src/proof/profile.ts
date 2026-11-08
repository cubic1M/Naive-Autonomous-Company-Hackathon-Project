/**
 * Verification profile: how strictly a proof is checked, derived from the job. Strictness scales with
 * what is at stake, so the agents can close cheap jobs on their own and spend the expensive checks
 * (EXIF capture time, two photos, a 0.90 score) where a wrong approval costs real money or a licence.
 *
 *   tier 0  budget under $50, no certification   1 photo, device GPS and device capture time accepted
 *                                                when EXIF has none, confidence >= 0.80
 *   tier 1  $50 to $150                          EXIF capture time required (missing -> review), >= 0.85
 *   tier 2  above $150, or any certification     2 photos, EXIF required, >= 0.90
 *
 * The identity does not scale: every job, at every tier, needs a worker with a verified Stripe Identity (the
 * "verified human" Operis promises). IDENTITY_GATE (env.ts) only decides whether a missing one blocks.
 *
 * `risk_class` (low | standard | high) overrides the budget tier; a certification still forces tier 2; the
 * customer's own proof requirement (photos.min, must_show, geofence_m, fields) always applies on top, the photo
 * minimum by max, and only for a photo proof (a video- or files-only requirement has no tier photo minimum).
 * `required_tier` is not read here: it is the minimum worker tier (eligibility.ts).
 */
import type { IdentityGate } from '../env.js';
import type { Job } from '../types.js';

export type VerificationTier = 0 | 1 | 2;
export type ExifTimePolicy = 'require' | 'device_fallback';

export interface TierRules {
  /** Vision confidence needed for automatic approval (and for approve_proof without override). */
  confidenceThreshold: number;
  /** Images the proof must contain before the customer's own minimum is composed in. */
  minPhotos: number;
  /** 'require': no EXIF capture time is a review flag. 'device_fallback': the proof's device captured_at stands in. */
  exifTimePolicy: ExifTimePolicy;
}

export interface VerificationProfile extends TierRules {
  tier: VerificationTier;
  /**
   * Every job requires a verified Stripe Identity (worker_verifications kind 'identity'); this says whether a missing
   * one blocks (IDENTITY_GATE=enforce, the default) or is only recorded (log).
   */
  identityEnforced: boolean;
  /** The customer requires a certification (a notary commission, or anything in jobs.certification_required). */
  certificationRequired: boolean;
  /** How the tier was derived, one line per rule that applied; shown in check_proof evidence. */
  notes: string[];
}

/** Budget boundaries, in cents: under $50 is tier 0, $50 to $150 inclusive is tier 1, above $150 is tier 2. */
export const TIER_1_FROM_CENTS = 5_000;
export const TIER_2_ABOVE_CENTS = 15_000;

export const TIER_RULES: Record<VerificationTier, TierRules> = {
  0: { confidenceThreshold: 0.8, minPhotos: 1, exifTimePolicy: 'device_fallback' },
  1: { confidenceThreshold: 0.85, minPhotos: 1, exifTimePolicy: 'require' },
  2: { confidenceThreshold: 0.9, minPhotos: 2, exifTimePolicy: 'require' },
};

const RISK_CLASS_TIER: Record<string, VerificationTier> = { low: 0, standard: 1, high: 2 };

const usd = (cents: number): string => '$' + (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

export function budgetTier(budgetCents: number): VerificationTier {
  if (budgetCents < TIER_1_FROM_CENTS) return 0;
  if (budgetCents <= TIER_2_ABOVE_CENTS) return 1;
  return 2;
}

/** What a customer agent writes when it means "no certification", compared trimmed, lowercased, spaces collapsed. */
const NO_CERTIFICATION = new Set(['', 'none', 'no', 'n/a', 'na', 'nil', 'null', 'false', 'not required', 'not applicable', '-']);

/**
 * The certification a job really requires: null for null, blank, or a placeholder meaning none ("none", "N/A",
 * "not required", ...). Read wherever certification drives the tier (here) or the task type (repo/postgres.ts).
 */
export function requiredCertification(written: string | null | undefined): string | null {
  const value = (written ?? '').trim();
  return NO_CERTIFICATION.has(value.toLowerCase().replace(/\s+/g, ' ')) ? null : value;
}

/** `identityGate` is IDENTITY_GATE (env.ts); omitted, the identity rule is enforced. */
export function verificationProfile(job: Job, opts: { identityGate?: IdentityGate } = {}): VerificationProfile {
  const notes: string[] = [];
  let tier = budgetTier(job.budget_cents);
  notes.push(`budget ${usd(job.budget_cents)}: tier ${tier}`);

  if (job.risk_class) {
    const key = job.risk_class.trim().toLowerCase();
    // own keys only: 'constructor' or '__proto__' must be an unknown value, not Object or Object.prototype
    const risk = Object.hasOwn(RISK_CLASS_TIER, key) ? RISK_CLASS_TIER[key] : undefined;
    if (risk === undefined) {
      notes.push(`risk_class ${job.risk_class} is not low | standard | high; ignored`);
    } else {
      tier = risk;
      notes.push(`risk_class ${key}: tier ${risk} (overrides the budget tier)`);
    }
  }

  const named = requiredCertification(job.certification_required);
  const written = job.certification_required?.trim() ?? '';
  if (named === null && written !== '') notes.push(`certification_required "${written}" means none; ignored`);
  const certification = named ?? (job.task_type === 'notarization' ? 'notary commission' : '');
  const certificationRequired = certification !== '';
  if (certificationRequired) {
    if (tier < 2) tier = 2;
    notes.push(`certification required (${certification}): tier 2`);
  }

  const rules = TIER_RULES[tier];
  const customerMin = job.proof_schema.photos.min;
  const photosRequested = job.proof_schema.photos.requested !== false;
  const minPhotos = photosRequested ? Math.max(rules.minPhotos, customerMin) : customerMin;
  if (!photosRequested) {
    notes.push('the proof requirement asks for video or files, not photos: no tier photo minimum; such a proof goes to a human');
  } else if (customerMin > rules.minPhotos) {
    notes.push(`customer requires ${customerMin} photos (tier minimum ${rules.minPhotos})`);
  }

  const identityEnforced = (opts.identityGate ?? 'enforce') === 'enforce';
  if (!identityEnforced) notes.push('IDENTITY_GATE=log: the identity check is recorded, not enforced');

  return { tier, ...rules, minPhotos, identityEnforced, certificationRequired, notes };
}

/** One line for the evidence an agent reads, e.g. "tier 2: confidence >= 0.9, >= 2 photos, EXIF capture time required, verified identity required". */
export function describeProfile(p: VerificationProfile): string {
  const parts = [
    `confidence >= ${p.confidenceThreshold}`,
    `>= ${p.minPhotos} photo${p.minPhotos === 1 ? '' : 's'}`,
    p.exifTimePolicy === 'require' ? 'EXIF capture time required' : 'device capture time accepted when EXIF has none',
    p.identityEnforced ? 'verified identity required' : 'identity recorded, not enforced (IDENTITY_GATE=log)',
  ];
  if (p.certificationRequired) parts.push('certification required');
  return `tier ${p.tier}: ${parts.join(', ')}`;
}

/** The profile as snake_case data for ProofCheck.data and the check_proof evidence. */
export function profileData(p: VerificationProfile): Record<string, unknown> {
  return {
    tier: p.tier,
    confidence_threshold: p.confidenceThreshold,
    min_photos: p.minPhotos,
    exif_time_policy: p.exifTimePolicy,
    identity_required: true, // every job; kept so readers of identity_required need no change
    identity_enforced: p.identityEnforced,
    certification_required: p.certificationRequired,
    notes: p.notes,
  };
}
