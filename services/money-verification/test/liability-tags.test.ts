// services/money-verification/test/liability-tags.test.ts
import { describe, expect, it } from 'vitest';
import { POLICY_VERSION, RULES, policyText, ruleById } from '../src/liability/policy.js';
import { normalizeCertification, tagJob } from '../src/liability/tags.js';

const job = (title: string, instructions = '', certification_required: string | null = null) => ({ title, instructions, certification_required });

describe('liability policy', () => {
  it('has unique rule ids and a description for each', () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'D', 'U', 'R']);
    for (const r of RULES) expect(r.description.length).toBeGreaterThan(20);
  });
  it('renders every rule and the setup into the agent-facing text', () => {
    const text = policyText();
    expect(text).toContain(`Liability policy ${POLICY_VERSION}`);
    expect(text).toContain('insurance none');
    for (const r of RULES) expect(text).toContain(`${r.id} ${r.title}`);
  });
  it('looks rules up by id', () => {
    expect(ruleById('L2')?.licence).toBe('attorney_license');
    expect(ruleById('nope')).toBeUndefined();
  });
});

describe('tagJob', () => {
  const table: Array<[string, ReturnType<typeof job>, string[], 'connector' | 'refuse' | null, 'standard' | 'connector']> = [
    ['plain photo job', job('Photograph the YC sign', 'Two photos at the entrance'), [], null, 'standard'],
    ['wait in line', job('Wait in line at the DMV', 'Hold a spot until 3pm'), [], null, 'standard'],
    ['notarize', job('Notarize a deed', 'Mobile notary at our office'), ['L1'], 'connector', 'connector'],
    ['notary via certification', job('Witness a signature', 'At our office', 'California notary commission'), ['L1'], 'connector', 'connector'],
    ['signing agent', job('Loan signing agent needed', 'Refinance packet'), ['L1'], 'connector', 'connector'],
    ['contract review', job('Review our SaaS terms of service', 'Online contract review'), ['L2'], 'connector', 'connector'],
    ['legal advice', job('Need legal advice on a lease', 'Thirty minute call'), ['L2'], 'connector', 'connector'],
    ['bar licence certification', job('Look over an NDA', 'Two pages', 'California bar license'), ['L2'], 'connector', 'connector'],
    ['electrical', job('Rewire a kitchen outlet', 'Replace the wiring'), ['L3'], 'refuse', 'standard'],
    ['plumbing', job('Fix a leaking pipe', 'Plumbing under the sink'), ['L3'], 'refuse', 'standard'],
    ['handyman', job('Assemble an IKEA desk', 'Bring a screwdriver'), [], null, 'standard'],
    ['realtor', job('Real estate agent to list my house', 'Sunset district'), ['L4'], 'refuse', 'standard'],
    ['security', job('Security guard for an event', 'Friday night'), ['L5'], 'refuse', 'standard'],
    ['tax', job('Prepare my tax return', '1040 with schedule C'), ['L6'], 'refuse', 'standard'],
    ['notary and trade', job('Notarize permit and rewire the panel', ''), ['L1', 'L3'], 'refuse', 'standard'],
    ['counseling is not counsel', job('Peer counseling session notes', 'Type up notes'), [], null, 'standard'],
    ['certification none', job('Photograph a storefront', '', 'none'), [], null, 'standard'],
    ['certification N/A', job('Deliver a letter', '', 'N/A'), [], null, 'standard'],
  ];
  it.each(table)('%s', (_name, input, rules, forced, pricing) => {
    expect(tagJob(input)).toEqual({ rules, forced, pricing });
  });
});

describe('normalizeCertification', () => {
  it('treats negative words as no certification', () => {
    for (const v of ['', ' ', '-', 'none', 'No', 'N/A', 'na', 'nil', 'NULL', 'false', 'not required', 'Not applicable']) {
      expect(normalizeCertification(v)).toBeNull();
    }
    expect(normalizeCertification(null)).toBeNull();
    expect(normalizeCertification(' Notary commission ')).toBe('Notary commission');
  });
});
