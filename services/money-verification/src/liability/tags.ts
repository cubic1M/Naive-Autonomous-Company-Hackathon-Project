// services/money-verification/src/liability/tags.ts
import { RULES, type RuleId } from './policy.js';

export type Pricing = 'standard' | 'connector';

export interface JobTags {
  /** Rules whose intake keywords match, in policy order. */
  rules: RuleId[];
  /** A model the agent cannot overrule: refuse when any matched rule refuses, connector when one requires it. */
  forced: 'connector' | 'refuse' | null;
  /** Connector pricing only for L1/L2 jobs that are not refused. */
  pricing: Pricing;
}

const NEGATIVE = new Set(['', '-', 'none', 'no', 'n/a', 'na', 'nil', 'null', 'false', 'not required', 'not applicable']);

/** Customer agents write "none" or "N/A" instead of null; those mean no certification. */
export function normalizeCertification(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = value.trim();
  return NEGATIVE.has(v.toLowerCase()) ? null : v;
}

export function tagJob(input: { title: string; instructions: string; certification_required: string | null }): JobTags {
  const text = [input.title, input.instructions, normalizeCertification(input.certification_required) ?? ''].join('\n');
  const matched = RULES.filter((r) => r.keywords.some((k) => k.test(text)));
  const forced = matched.some((r) => r.model === 'refuse')
    ? 'refuse'
    : matched.some((r) => r.model === 'connector')
      ? 'connector'
      : null;
  return { rules: matched.map((r) => r.id), forced, pricing: forced === 'connector' ? 'connector' : 'standard' };
}
