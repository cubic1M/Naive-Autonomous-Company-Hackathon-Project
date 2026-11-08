import { describe, expect, it } from 'vitest';
import { FAMILIES } from '../src/families.js';
import { cleanPersonalLine, PENDING_ADDRESS, renderInvite, renderMarketing } from '../src/templates.js';

const UNSUB = 'https://operis.live/v1/growth/unsubscribe?t=u.0b6f3c1e-8d2a-4c7b-9a1e-2f3d4c5b6a79.0.abc';
const ADDRESS = '1 Example St, San Francisco, CA 94100';
const marketing = { firstName: 'Jane', personalLine: null, promo: null, foundVia: 'the YC x Naïve hackathon team list', postalAddress: ADDRESS, unsubscribeUrl: UNSUB };

describe('renderMarketing', () => {
  it('carries every required part', () => {
    const m = renderMarketing(marketing);
    expect(m.subject).not.toMatch(/^(re|fwd?):/i);
    for (const part of [
      'Hi Jane,',
      'request_human',
      'https://operis.live/SKILL.md',
      'https://operis.live/mcp',
      'https://operis.live/developers',
      'How we found you: the YC x Naïve hackathon team list.',
      'This is a marketing email from Operis.',
      'Operis Sales (an AI agent) · operis.live',
      ADDRESS,
      UNSUB,
    ]) expect(m.text).toContain(part);
    expect(m.text).not.toContain('first job is on us');
  });

  it('adds the personal line and the promo only when given', () => {
    const m = renderMarketing({ ...marketing, personalLine: 'Your agent books venues.', promo: { capUsd: 25, expiresAt: new Date('2026-11-22T18:00:00Z') } });
    expect(m.text).toContain('Hi Jane,\n\nYour agent books venues.\n');
    expect(m.text).toContain("Your team's first job is on us: we refund it in full, up to $25, once the proof passes. One per team; the offer ends Sun Nov 22.");
  });

  it('greets without a name and marks a test email without a postal address', () => {
    const m = renderMarketing({ ...marketing, firstName: null, postalAddress: null });
    expect(m.text.startsWith('Hi there,')).toBe(true);
    expect(m.text).toContain(PENDING_ADDRESS);
  });
});

describe('renderInvite', () => {
  const f = FAMILIES.sf_notaries;
  const invite = { firstName: 'Ada', familyLabel: f.label, familySubject: f.subject, joinUrl: 'https://operis.live/v1/growth/join?t=j.x', foundVia: 'your public LinkedIn profile, where you list "Mobile notary"', postalAddress: ADDRESS, unsubscribeUrl: UNSUB };

  it('carries the family, join link, ID step, found line, label, address and unsubscribe link', () => {
    const m = renderInvite(invite);
    expect(m.subject).toBe('Join Operis: paid notary signings in San Francisco');
    for (const part of [
      'Hi Ada,',
      'The work: mobile notary signings in San Francisco.',
      'https://operis.live/v1/growth/join?t=j.x',
      'verify your ID once with Stripe',
      'How we found you: your public LinkedIn profile, where you list "Mobile notary".',
      'This is an invitation from Operis.',
      ADDRESS,
      UNSUB,
    ]) expect(m.text).toContain(part);
  });

  it('never states a pay amount', () => {
    expect(renderInvite(invite).text).not.toMatch(/\$\s?\d/);
  });
});

describe('cleanPersonalLine', () => {
  it('keeps one tidy line, at most 300 characters, with no links', () => {
    expect(cleanPersonalLine('  Loved   your\nagent ')).toEqual({ ok: true, line: 'Loved your agent' });
    expect(cleanPersonalLine(undefined)).toEqual({ ok: true, line: null });
    expect(cleanPersonalLine('see https://x.example')).toEqual({ ok: false, reason: 'personal_line_has_link' });
    expect(cleanPersonalLine('see www.agentco.dev')).toEqual({ ok: false, reason: 'personal_line_has_link' });
    expect(cleanPersonalLine('see agentco.dev')).toEqual({ ok: false, reason: 'personal_line_has_link' });
    expect(cleanPersonalLine('a'.repeat(301))).toEqual({ ok: false, reason: 'personal_line_too_long' });
    expect(cleanPersonalLine('Built with Next.js and React')).toEqual({ ok: true, line: 'Built with Next.js and React' });
  });
});
