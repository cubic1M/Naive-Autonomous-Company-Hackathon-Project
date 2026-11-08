// services/money-verification/src/liability/policy.ts
// Per-job liability policy (docs/specs/2026-11-08-liability-model-design.md). Draft for counsel, not legal advice.
// Growing is an edit here: insurance or a company licence moves a category to operis; a new licence verifier
// moves a refuse category to connector.
export const POLICY_VERSION = '2026-11-08';

export type LiabilityModel = 'operis' | 'connector' | 'refuse';
export type RuleId = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'D' | 'U' | 'R';
export type LicenceKind = 'notary_commission' | 'attorney_license';

export interface LiabilityRule {
  id: RuleId;
  title: string;
  /** Plain-language rule the Compliance agent reads. */
  description: string;
  model: LiabilityModel;
  /** Licence the worker must hold, checked before accept; null when none. */
  licence: LicenceKind | null;
  /** Intake keywords matched against title, instructions and certification_required. Empty for D, U and R. */
  keywords: RegExp[];
}

/** What Operis has today. */
export const SETUP = { jurisdiction: 'California', insurance: [] as string[], companyLicences: [] as string[] };

export const RULES: readonly LiabilityRule[] = [
  {
    id: 'L1', title: 'Notarial acts', model: 'connector', licence: 'notary_commission',
    description: 'Notarizing a document, acting as a notary or as a loan signing agent. Notary commissions are issued to individuals only, so Operis cannot hold this liability; the commissioned notary does.',
    keywords: [/\bnotar(y|ies|ize|ise|ized|ised|izing|ising|ization|isation|ial)\b/i, /\bsigning agent\b/i],
  },
  {
    id: 'L2', title: 'Legal services', model: 'connector', licence: 'attorney_license',
    description: 'Legal advice, legal document review or drafting, contract review, or anything else that is the practice of law. Only licensed attorneys may provide it and California does not allow non-lawyer ownership of legal services, so the attorney holds this liability.',
    keywords: [
      /\b(attorney|lawyer|counsel|paralegal)s?\b/i,
      /\blegal (advice|review|services?|opinion|documents?)\b/i,
      /\b(contract|lease|nda|terms of service) review\b/i,
      /\breview (our|my|the|a|this) (contract|lease|nda|terms of service|agreement)\b/i,
      /\bbar (license|licence|number|admission)\b/i,
    ],
  },
  {
    id: 'L3', title: 'Licensed trades', model: 'refuse', licence: null,
    description: 'Work that legally needs a contractor licence, such as electrical wiring, plumbing, HVAC, gas lines or structural work. Refused until Operis can verify contractor licences. Small handyman tasks such as assembling furniture are not L3.',
    keywords: [/\b(electrical wiring|rewir(e|ing)|electrician|plumb(er|ing)|hvac|gas line|load[- ]bearing|structural work|roofing|contractor'?s? licen[cs]e)\b/i],
  },
  {
    id: 'L4', title: 'Real estate brokerage', model: 'refuse', licence: null,
    description: 'Listing, selling, leasing or negotiating real estate for others for pay. Refused until Operis can verify broker licences.',
    keywords: [/\b(real estate (agent|broker)|realtor|list (my|our|a) (house|home|property))\b/i],
  },
  {
    id: 'L5', title: 'Licensed security work', model: 'refuse', licence: null,
    description: 'Security guard, bodyguard, patrol or private investigation work. Refused until Operis can verify those licences.',
    keywords: [/\b(security guard|bodyguard|bouncer|private investigat(or|ion))\b/i],
  },
  {
    id: 'L6', title: 'Paid tax preparation', model: 'refuse', licence: null,
    description: 'Preparing or filing tax returns for pay. Refused until Operis can verify preparer registration.',
    keywords: [/\b(tax return|tax prep(aration)?|file (my|our) taxes)\b/i],
  },
  {
    id: 'D', title: 'Everything else', model: 'operis', licence: null,
    description: 'A job that passed intake and matches none of the rules above. Operis is the provider and holds the liability.',
    keywords: [],
  },
  {
    id: 'U', title: 'Unsure or no decision in time', model: 'connector', licence: null,
    description: 'Use when you cannot tell whether a rule applies. The worker is the provider. The system also records U when no decision arrives within fifteen minutes.',
    keywords: [],
  },
  {
    id: 'R', title: 'Unsafe or illegal, missed at intake', model: 'refuse', licence: null,
    description: 'Use when the job is illegal, dangerous, identity work, surveillance or signing on someone\'s behalf and intake did not catch it.',
    keywords: [],
  },
];

export function ruleById(id: string): LiabilityRule | undefined {
  return RULES.find((r) => r.id === id);
}

/** The policy as the Compliance agent reads it (returned by get_liability_context). */
export function policyText(): string {
  const list = (xs: string[]) => (xs.length ? xs.join(', ') : 'none');
  const setup = `Operis setup (${SETUP.jurisdiction}): insurance ${list(SETUP.insurance)}; company licences ${list(SETUP.companyLicences)}.`;
  const rules = RULES.map(
    (r) => `${r.id} ${r.title} -> ${r.model}${r.licence ? ` (worker licence checked before accept: ${r.licence})` : ''}. ${r.description}`,
  );
  return [`Liability policy ${POLICY_VERSION}`, setup, ...rules].join('\n');
}
