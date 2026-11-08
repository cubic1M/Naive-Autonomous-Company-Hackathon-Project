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
  /**
   * A request for the regulated work itself (notarize, review a contract, replace the wiring), matched on title and
   * instructions; a match not negated just before it ("no", "not", "don't need a") forces the rule.
   */
  work: RegExp[];
  /** A licence the customer asks of the worker, matched on certification_required: forces the rule. */
  certification: RegExp[];
  /** A mention of the profession, document or office (a lawyer, a notary, a tax return): only a hint for Compliance. */
  mentions: RegExp[];
  /** Phrases removed before this rule is matched, because they name something else ("power of attorney"). */
  ignore: RegExp[];
}

/** What Operis has today. */
export const SETUP = { jurisdiction: 'California', insurance: [] as string[], companyLicences: [] as string[] };

const none: RegExp[] = [];

export const RULES: readonly LiabilityRule[] = [
  {
    id: 'L1', title: 'Notarial acts', model: 'connector', licence: 'notary_commission',
    description: 'Notarizing a document, acting as a notary or as a loan signing agent. Notary commissions are issued to individuals only, so Operis cannot hold this liability; the commissioned notary does. Carrying a document to or from a notary is not L1.',
    work: [
      /\bnotari[sz](?:e|es|ing|ation|ations)\b/i,
      /\b(?:get|have|getting|having)\s+(?:it|this|that|these|those|them|(?:the|our|my|a|an|this|that|these|those|two|three|\d+)\s+[\w-]+(?:\s+[\w-]+)?)\s+notari[sz]ed\b/i,
      /\bnotarial\s+(?:acts?|certificates?|services?|work)\b/i,
      /\bsigning\s+agents?\b/i,
      /\b(?:need|needs|needed|require|requires|required|want|wants|looking\s+for|hire|book|send)\s+(?:(?:a|an|one|two)\s+)?(?:(?:mobile|commissioned|california|licensed)\s+)?notary\b/i,
      /\bnotary\s+(?:needed|required|wanted)\b/i,
      /\bact(?:s|ing)?\s+as\s+(?:a|the|our)\s+notary\b/i,
    ],
    certification: [/\bnotar/i],
    mentions: [/\bnotar(?:y|ies|i[sz]ed)\b/i],
    ignore: none,
  },
  {
    id: 'L2', title: 'Legal services', model: 'connector', licence: 'attorney_license',
    description: 'Legal advice, review or drafting of a contract, lease, NDA, terms or agreement, a legal opinion, or anything else that is the practice of law. Only licensed attorneys may provide it and California does not allow non-lawyer ownership of legal services, so the attorney holds this liability. Delivering, scanning or filing papers for a lawyer is not L2.',
    work: [
      /\blegal\s+(?:advice|review|drafting|opinions?|representation|consultation)\b/i,
      /\b(?:review|reviewing|draft|drafting|redline|redlining|revise|revising|look\s+over|go\s+over|read\s+over|mark\s+up)\b[^.;:!?\n]{0,30}?\b(?:contracts?|leases?|ndas?|terms|agreements?|wills?|trusts?|bylaws)\b/i,
      /\b(?:contract|lease|nda|terms(?:\s+of\s+service)?|agreement)s?\s+(?:review|drafting|redline|redlining)\b/i,
      /\bpractice\s+of\s+law\b/i,
    ],
    certification: [/\b(?:bar\s+(?:license|licence|number|card|admission|membership)|state\s+bar|attorney|lawyer|esq)\b/i],
    mentions: [
      /\b(?:lawyers?|attorneys?|attorney's|counsel|paralegals?|law\s+(?:firm|office))\b/i,
      /\blegal\s+(?:documents?|papers?|paperwork|forms?|filings?|matters?)\b/i,
    ],
    ignore: [/\bpower\s+of\s+attorney\b/gi, /\bdistrict\s+attorney(?:'s)?\b/gi, /\battorney\s+general\b/gi],
  },
  {
    id: 'L3', title: 'Licensed trades', model: 'refuse', licence: null,
    description: 'Work that legally needs a contractor licence: installing, repairing or replacing wiring, outlets, pipes, plumbing, gas lines or a roof, or structural work. Refused until Operis can verify contractor licences. Small handyman tasks, and errands that only involve a tradesperson (letting a plumber in), are not L3.',
    work: [
      /\b(?:install|installing|repair|repairing|replace|replacing|fix|fixing|rewire|rewiring|re-wire|reroute|rerouting)\b[^.;:!?\n]{0,30}?\b(?:wiring|wires?|outlets?|sockets?|circuits?|breakers?|electrical\s+panels?|pipes?|piping|plumbing|drains?|gas\s+lines?|gas\s+pipes?|roofs?|roofing|shingles)\b/i,
      /\brewir(?:e|es|ed|ing)\b/i,
      /\b(?:electrical|plumbing|roofing|structural)\s+(?:work|repairs?|jobs?|installation)\b/i,
      /\b(?:remove|removing|move|moving|open\s+up)\s+(?:a|the)\s+load[- ]bearing\s+wall\b/i,
      /\bhvac\s+(?:install|installation|repairs?|replacement|work)\b/i,
    ],
    certification: [/\b(?:contractor'?s?\s+licen[cs]e|cslb|c-?10|c-?36|c-?39|electrician|plumber|roofer)\b/i],
    mentions: [/\b(?:electricians?|plumbers?|roofers?|hvac|wiring|plumbing)\b/i],
    ignore: none,
  },
  {
    id: 'L4', title: 'Real estate brokerage', model: 'refuse', licence: null,
    description: 'Listing, selling, leasing or negotiating real estate for others for pay. Refused until Operis can verify broker licences.',
    work: [
      /\b(?:list|sell|selling|market|marketing|lease\s+out|rent\s+out)\s+(?:my|our|the|a|this|their)\s+(?:[\w-]+\s+)?(?:house|home|condo|apartment|property|unit|building|land)\b/i,
      /\b(?:act|acting|work|working)\s+as\s+(?:a|an|our|my)\s+(?:real\s+estate\s+)?(?:agent|broker|realtor)\b/i,
    ],
    certification: [/\b(?:real\s+estate|broker'?s?\s+licen[cs]e|realtor|dre)\b/i],
    mentions: [/\b(?:real\s+estate\s+(?:agents?|brokers?)|realtors?|open\s+house|listing\s+agents?)\b/i],
    ignore: none,
  },
  {
    id: 'L5', title: 'Licensed security work', model: 'refuse', licence: null,
    description: 'Working as a security guard, bodyguard or bouncer, guarding an event or a property, or private investigation. Refused until Operis can verify those licences. Talking to a guard is not L5.',
    work: [
      /\b(?:work|working|act|acting|serve|serving)\s+as\s+(?:a|an|our|the)\s+(?:security\s+guard|guard|bodyguard|bouncer|security)\b/i,
      /\bguard\s+(?:an?|the|our|my)\s+(?:[\w-]+\s+)?(?:event|venue|party|door|entrance|property|building|site|store|warehouse)\b/i,
      /\b(?:security\s+guards?|bodyguards?|bouncers?|security\s+staff)\s+(?:for|at)\s+(?:an?|the|our|my)\s+(?:[\w-]+\s+)?(?:event|party|venue|concert|wedding|launch|meetup|conference|store)\b/i,
      /\bprivate\s+investigation\b/i,
    ],
    certification: [/\b(?:guard\s+card|bsis|security\s+(?:guard\s+)?licen[cs]e)\b/i],
    mentions: [/\b(?:security\s+guards?|bodyguards?|bouncers?|private\s+investigators?)\b/i],
    ignore: none,
  },
  {
    id: 'L6', title: 'Paid tax preparation', model: 'refuse', licence: null,
    description: 'Preparing or filing tax returns for pay. Refused until Operis can verify preparer registration. Mailing or delivering a return someone else prepared is not L6.',
    work: [
      /\b(?:prepare|preparing|file|filing|do|doing|complete|completing|e-?file)\s+(?:my|our|the|a|their|his|her)\s+(?:\d{4}\s+)?(?:(?:federal|state)\s+)?(?:tax\s+returns?|taxes|1040s?|tax\s+filing)\b/i,
      /\btax\s+(?:prep|preparation)\s+(?:for|of)\b/i,
    ],
    certification: [/\b(?:tax\s+preparer|ptin|crtp|enrolled\s+agent)\b/i],
    mentions: [/\b(?:tax\s+returns?|taxes|1040s?|tax\s+(?:documents?|forms?))\b/i],
    ignore: none,
  },
  {
    id: 'D', title: 'Everything else', model: 'operis', licence: null,
    description: 'A job that passed intake and matches none of the rules above. Operis is the provider and holds the liability.',
    work: none, certification: none, mentions: none, ignore: none,
  },
  {
    id: 'U', title: 'Unsure or no decision in time', model: 'connector', licence: null,
    description: 'Use when you cannot tell whether a rule applies. The worker is the provider. When no decision arrives within fifteen minutes the system records the rule intake tagged, or U when there is none.',
    work: none, certification: none, mentions: none, ignore: none,
  },
  {
    id: 'R', title: 'Unsafe or illegal, missed at intake', model: 'refuse', licence: null,
    description: 'Use when the job is illegal, dangerous, identity work, surveillance or signing on someone\'s behalf and intake did not catch it.',
    work: none, certification: none, mentions: none, ignore: none,
  },
];

export function ruleById(id: string): LiabilityRule | undefined {
  return RULES.find((r) => r.id === id);
}

/** The policy as the Compliance agent reads it (returned by get_liability_context). */
export function policyText(): string {
  const list = (xs: string[]) => (xs.length ? xs.join(', ') : 'none');
  const setup = `Operis setup (${SETUP.jurisdiction}): insurance ${list(SETUP.insurance)}; company licences ${list(SETUP.companyLicences)}.`;
  const hints =
    'Tags and hints: intake tags a rule only when the job asks for the regulated work itself; a tag forces the model. Hints are mentions intake found (a lawyer, a notary, a tax return) that force nothing. Decide whether the job is that work: an errand around a professional or a document (carrying, scanning, mailing, waiting) is D; if it is the licensed work, apply its rule.';
  const rules = RULES.map(
    (r) => `${r.id} ${r.title} -> ${r.model}${r.licence ? ` (worker licence checked before accept: ${r.licence})` : ''}. ${r.description}`,
  );
  return [`Liability policy ${POLICY_VERSION}`, setup, hints, ...rules].join('\n');
}
