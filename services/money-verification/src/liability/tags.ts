// services/money-verification/src/liability/tags.ts
import { RULES, type LiabilityRule, type RuleId } from './policy.js';

export type Pricing = 'standard' | 'connector';

export interface JobTags {
  /**
   * Rules the job asks for the regulated work of (notarize, review a contract, replace the wiring), or names in
   * certification_required, in policy order. These force the model.
   */
  rules: RuleId[];
  /** A model the agent cannot overrule: refuse when any tagged rule refuses, connector when one requires it. */
  forced: 'connector' | 'refuse' | null;
  /** Connector pricing only for L1/L2 jobs that are not refused. */
  pricing: Pricing;
  /** Rules only mentioned (a lawyer, a notary, a tax return), not tagged: Compliance judges them; they force nothing. */
  hints: RuleId[];
}

const NEGATIVE = new Set(['', '-', 'none', 'no', 'n/a', 'na', 'nil', 'null', 'false', 'not required', 'not applicable']);

/** Customer agents write "none" or "N/A" instead of null; those mean no certification. */
export function normalizeCertification(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = value.trim();
  return NEGATIVE.has(v.toLowerCase()) ? null : v;
}

/** "no", "not", "without", "don't need a": negates a match at most two words later ("no electrician needed"). */
const NEGATED_BEFORE = /\b(?:no|not|never|without|don't|dont|doesn't|doesnt|isn't|isnt|aren't|arent|won't|wont)\b(?:\s+[a-z][\w'-]*){0,2}\s*$/i;
/** "... not needed", "... is not required". */
const NEGATED_AFTER = /^\s*(?:(?:is|are)\s+)?(?:not\s+(?:needed|required|necessary)|unnecessary)\b/i;

/** True when some pattern matches somewhere it is not negated. */
function found(patterns: readonly RegExp[], text: string): boolean {
  for (const p of patterns) {
    const every = new RegExp(p.source, p.flags.includes('g') ? p.flags : `${p.flags}g`);
    for (const m of text.matchAll(every)) {
      const start = m.index ?? 0;
      const before = text.slice(Math.max(0, start - 60), start);
      const after = text.slice(start + m[0].length, start + m[0].length + 40);
      if (!NEGATED_BEFORE.test(before) && !NEGATED_AFTER.test(after)) return true;
    }
  }
  return false;
}

const without = (text: string, phrases: readonly RegExp[]) => phrases.reduce((t, p) => t.replace(p, ' '), text);

export function tagJob(input: { title: string; instructions: string; certification_required: string | null }): JobTags {
  const text = `${input.title}\n${input.instructions}`;
  const certification = normalizeCertification(input.certification_required);
  const tagged: LiabilityRule[] = [];
  const hinted: LiabilityRule[] = [];
  for (const rule of RULES) {
    const t = without(text, rule.ignore);
    if (found(rule.work, t) || (certification !== null && rule.certification.some((c) => c.test(certification)))) tagged.push(rule);
    else if (found(rule.mentions, t)) hinted.push(rule);
  }
  const forced = tagged.some((r) => r.model === 'refuse')
    ? 'refuse'
    : tagged.some((r) => r.model === 'connector')
      ? 'connector'
      : null;
  return {
    rules: tagged.map((r) => r.id),
    forced,
    pricing: forced === 'connector' ? 'connector' : 'standard',
    hints: hinted.map((r) => r.id),
  };
}
