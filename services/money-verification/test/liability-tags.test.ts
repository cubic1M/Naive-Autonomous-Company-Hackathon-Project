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
  it('renders every rule, the setup and how hints work into the agent-facing text', () => {
    const text = policyText();
    expect(text).toContain(`Liability policy ${POLICY_VERSION}`);
    expect(text).toContain('insurance none');
    expect(text).toContain('Hints');
    for (const r of RULES) expect(text).toContain(`${r.id} ${r.title}`);
  });
  it('looks rules up by id', () => {
    expect(ruleById('L2')?.licence).toBe('attorney_license');
    expect(ruleById('nope')).toBeUndefined();
  });
});

type Row = [string, ReturnType<typeof job>, string[], 'connector' | 'refuse' | null, 'standard' | 'connector', string[]];

describe('tagJob: a request for the regulated work forces the rule', () => {
  const table: Row[] = [
    ['notarize', job('Notarize a deed', 'Mobile notary at our office'), ['L1'], 'connector', 'connector', []],
    ['notary via certification', job('Witness a signature', 'At our office', 'California notary commission'), ['L1'], 'connector', 'connector', []],
    ['signing agent', job('Loan signing agent needed', 'Refinance packet'), ['L1'], 'connector', 'connector', []],
    ['need a notary', job('Need a notary for a closing'), ['L1'], 'connector', 'connector', []],
    ['notarization', job('Notarization of two affidavits'), ['L1'], 'connector', 'connector', []],
    ['notarial act', job('Notarial act for an I-9 form'), ['L1'], 'connector', 'connector', []],
    ['get it notarized', job('Get this deed notarized today'), ['L1'], 'connector', 'connector', []],
    ['notarize a power of attorney', job('Notarize a power of attorney', 'Mobile notary at our office'), ['L1'], 'connector', 'connector', []],
    ['notarize a POA', job('Notarize a POA', 'Mobile notary'), ['L1'], 'connector', 'connector', []],
    ['notarize legal documents', job('Notarize legal documents', 'Two signers'), ['L1'], 'connector', 'connector', ['L2']],
    ['notarize for my lawyer', job('Notarize an affidavit for my lawyer'), ['L1'], 'connector', 'connector', ['L2']],
    ['contract review', job('Review our SaaS terms of service', 'Online contract review'), ['L2'], 'connector', 'connector', []],
    ['review with a word before the document', job('Review our SaaS terms of service'), ['L2'], 'connector', 'connector', []],
    ['legal advice', job('Need legal advice on a lease', 'Thirty minute call'), ['L2'], 'connector', 'connector', []],
    ['legal opinion', job('Legal opinion on our privacy policy'), ['L2'], 'connector', 'connector', []],
    ['draft an NDA', job('Draft an NDA for our contractor'), ['L2'], 'connector', 'connector', []],
    ['review a lease agreement', job('Review our lease agreement before we sign'), ['L2'], 'connector', 'connector', []],
    ['practice of law', job('Advise whether this counts as the practice of law'), ['L2'], 'connector', 'connector', []],
    ['bar licence certification', job('Look over an NDA', 'Two pages', 'California bar license'), ['L2'], 'connector', 'connector', []],
    ['electrical', job('Rewire a kitchen outlet', 'Replace the wiring'), ['L3'], 'refuse', 'standard', []],
    ['plumbing', job('Fix a leaking pipe', 'Plumbing under the sink'), ['L3'], 'refuse', 'standard', []],
    ['install outlets', job('Install two new outlets in the garage'), ['L3'], 'refuse', 'standard', []],
    ['replace a gas line', job('Replace the gas line to the stove'), ['L3'], 'refuse', 'standard', []],
    ['repair a roof', job('Repair the roof after the storm'), ['L3'], 'refuse', 'standard', []],
    ['contractor licence certification', job('Replace a ceiling light', '', 'C-10 electrical contractor license'), ['L3'], 'refuse', 'standard', []],
    ['realtor', job('Real estate agent to list my house', 'Sunset district'), ['L4'], 'refuse', 'standard', []],
    ['security', job('Security guard for an event', 'Friday night'), ['L5'], 'refuse', 'standard', []],
    ['work as a security guard', job('Work as a security guard at our launch party'), ['L5'], 'refuse', 'standard', []],
    ['guard an event', job('Guard the event entrance on Friday'), ['L5'], 'refuse', 'standard', []],
    ['tax', job('Prepare my tax return', '1040 with schedule C'), ['L6'], 'refuse', 'standard', []],
    ['file a tax return', job('File our 2025 tax return'), ['L6'], 'refuse', 'standard', []],
    ['notary and trade', job('Notarize permit and rewire the panel', ''), ['L1', 'L3'], 'refuse', 'standard', []],
  ];
  it.each(table)('%s', (_name, input, rules, forced, pricing, hints) => {
    expect(tagJob(input)).toEqual({ rules, forced, pricing, hints });
  });
});

describe('tagJob: a mention of a profession, document or office is only a hint', () => {
  const table: Row[] = [
    ['plain photo job', job('Photograph the YC sign', 'Two photos at the entrance'), [], null, 'standard', []],
    ['wait in line', job('Wait in line at the DMV', 'Hold a spot until 3pm'), [], null, 'standard', []],
    ['handyman', job('Assemble an IKEA desk', 'Bring a screwdriver'), [], null, 'standard', []],
    ['counseling is not counsel', job('Peer counseling session notes', 'Type up notes'), [], null, 'standard', []],
    ['certification none', job('Photograph a storefront', '', 'none'), [], null, 'standard', []],
    ['certification N/A', job('Deliver a letter', '', 'N/A'), [], null, 'standard', []],
    ['contracts from our lawyer', job('Pick up signed contracts from our lawyer'), [], null, 'standard', ['L2']],
    ['scan and mail legal documents', job('Scan and mail our legal documents'), [], null, 'standard', ['L2']],
    ['courier legal documents', job('Courier: drop legal documents at the courthouse'), [], null, 'standard', ['L2']],
    ['deed to the notary', job('Drop off a deed at the notary'), [], null, 'standard', ['L1']],
    ['notarized documents from the bank', job('Pick up the notarized documents', 'From the bank'), [], null, 'standard', ['L1']],
    ['flowers to general counsel', job('Deliver flowers to our general counsel'), [], null, 'standard', ['L2']],
    ['package to general counsel', job('Deliver a package to our general counsel'), [], null, 'standard', ['L2']],
    ["attorney's office", job("Deliver a package to the attorney's office"), [], null, 'standard', ['L2']],
    ['District Attorney', job('Deliver an envelope to the District Attorney office'), [], null, 'standard', []],
    ['power of attorney alone', job('Mail the signed power of attorney to my bank'), [], null, 'standard', []],
    ["venue's bar license", job('Photograph the bar license posted at the venue'), [], null, 'standard', []],
    ['ask the security guard', job('Ask the security guard to let you in'), [], null, 'standard', ['L5']],
    ['wait for the electrician', job('Wait at the door for the electrician'), [], null, 'standard', ['L3']],
    ['wait for the plumber', job('Wait at my apartment for the plumber', 'Let them in at 2pm and stay until they leave'), [], null, 'standard', ['L3']],
    ['mail a tax return', job('Mail the envelope with our tax return'), [], null, 'standard', ['L6']],
    ['tax return at the post office', job('Mail my tax return at the post office'), [], null, 'standard', ['L6']],
    ['scan and mail a letter', job('Receive a letter, scan it, and mail it to this address'), [], null, 'standard', []],
  ];
  it.each(table)('%s', (_name, input, rules, forced, pricing, hints) => {
    expect(tagJob(input)).toEqual({ rules, forced, pricing, hints });
  });
});

describe('tagJob: negated mentions count for nothing', () => {
  const table: Row[] = [
    ['no electrician needed', job('Assemble a shelf', 'No electrician needed'), [], null, 'standard', []],
    ['no structural work', job('Hang a picture frame', 'Small nail only, no structural work'), [], null, 'standard', []],
    ['not legal advice', job('Photograph our storefront', 'This is not legal advice; just photos'), [], null, 'standard', []],
    ['do not notarize', job('Deliver the deed', 'Do not notarize anything'), [], null, 'standard', []],
    ['no notary needed', job('Witness a signing', 'No notary needed'), [], null, 'standard', []],
    ['negation does not reach past a dash', job('Kitchen outlet is not sparking - replace the wiring'), ['L3'], 'refuse', 'standard', []],
  ];
  it.each(table)('%s', (_name, input, rules, forced, pricing, hints) => {
    expect(tagJob(input)).toEqual({ rules, forced, pricing, hints });
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
