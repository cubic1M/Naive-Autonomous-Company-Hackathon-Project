/**
 * The two growth emails, plain text. Everything the law or our rules require is fixed here: who we are, that it is
 * marketing or an invitation, how we found the person, the postal address and a one-click unsubscribe link. The
 * Sales agent may add one personal line (cleanPersonalLine); the Recruiter adds nothing. First drafts of this copy
 * came from the local model and were rewritten line by line.
 */
import { greetingName } from '../../outreach/src/templates.js';
import { shortDate } from './time.js';

export interface EmailMessage {
  subject: string;
  text: string;
}

export const PERSONAL_LINE_MAX = 300;
/** Printed instead of the postal address on allowlisted test sends before GROWTH_POSTAL_ADDRESS is set. */
export const PENDING_ADDRESS = 'Postal address pending (test email to the Operis team)';

export const firstNameOf = (name: string | null): string | null => greetingName({ name, kind: 'person' });
const hello = (first: string | null) => `Hi ${first ?? 'there'},`;
const clause = (s: string) => s.replace(/[\s.]+$/, '');

export type CleanLine = { ok: true; line: string | null } | { ok: false; reason: 'personal_line_has_link' | 'personal_line_too_long' };

/** One line, no links, at most 300 characters. Empty input means no personal line. */
export function cleanPersonalLine(raw: string | null | undefined): CleanLine {
  const line = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!line) return { ok: true, line: null };
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|io|ai|dev|live|app|co|net|org|xyz|sh)\b/i.test(line)) return { ok: false, reason: 'personal_line_has_link' };
  if (line.length > PERSONAL_LINE_MAX) return { ok: false, reason: 'personal_line_too_long' };
  return { ok: true, line };
}

export interface MarketingCopy {
  firstName: string | null;
  personalLine: string | null;
  promo: { capUsd: number; expiresAt: Date } | null;
  foundVia: string;
  postalAddress: string | null;
  unsubscribeUrl: string;
}

export function renderMarketing(c: MarketingCopy): EmailMessage {
  const lines = [
    hello(c.firstName),
    '',
    ...(c.personalLine ? [c.personalLine, ''] : []),
    'Operis is a company run by AI agents. We send a real person to do real-world tasks for your agent: photograph or check a place, pick up and deliver an item, or be there for paperwork such as a notarization. Most on-site work is in San Francisco; some is remote, like contract review or coding help.',
    '',
    'Your agent calls one MCP tool, request_human. You pay only when the proof passes: we check every proof (photos, GPS and time) before charging. Jobs start at $20.',
    '',
    'Connect in a minute, no call needed:',
    '- Give your agent https://operis.live/SKILL.md',
    '- Or add the MCP server https://operis.live/mcp (you sign in in the browser)',
    '- Or get an API key at https://operis.live/developers',
    '',
    ...(c.promo
      ? [
          `Your team's first job is on us: we refund it in full, up to $${c.promo.capUsd}, once the proof passes. One per team; the offer ends ${shortDate(c.promo.expiresAt)}.`,
          '',
        ]
      : []),
    `How we found you: ${clause(c.foundVia)}.`,
    'This is a marketing email from Operis.',
    '',
    'Operis Sales (an AI agent) · operis.live',
    c.postalAddress ?? PENDING_ADDRESS,
    'Unsubscribe with one click and we will never email you again:',
    c.unsubscribeUrl,
  ];
  return { subject: 'Your agent can send a person to do real-world tasks', text: lines.join('\n') };
}

export interface InviteCopy {
  firstName: string | null;
  familyLabel: string;
  familySubject: string;
  joinUrl: string;
  foundVia: string;
  postalAddress: string | null;
  unsubscribeUrl: string;
}

export function renderInvite(c: InviteCopy): EmailMessage {
  const lines = [
    hello(c.firstName),
    '',
    'Operis is a company run by AI agents. We offer short, paid jobs from AI agents and businesses to people with the right skills.',
    '',
    `The work: ${clause(c.familyLabel)}.`,
    '',
    'Want job offers? Join with one click (no account, no fee):',
    c.joinUrl,
    '',
    'After joining you can verify your ID once with Stripe (about 2 minutes). Larger jobs and jobs that need a license require a verified ID.',
    '',
    'Every job shows its pay before you accept, and you are paid when the work is approved. Take only the jobs you want.',
    '',
    `How we found you: ${clause(c.foundVia)}.`,
    'This is an invitation from Operis.',
    '',
    'Operis · operis.live',
    c.postalAddress ?? PENDING_ADDRESS,
    'Unsubscribe with one click and we will never contact you again:',
    c.unsubscribeUrl,
  ];
  return { subject: `Join Operis: ${c.familySubject}`, text: lines.join('\n') };
}
