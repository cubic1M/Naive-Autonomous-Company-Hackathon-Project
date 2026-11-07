/**
 * Inbound reply handling (email to the ops inbox, SMS via the apps/api webhook).
 * Opt-out always wins. We never change job state here: 'accept_requested' is for the API owner to verify.
 */
import { normEmail, toE164 } from './geo.js';
import { InMemoryRepo } from './repo/memory.js';
import type { Repo } from './repo.js';
import { renderStopConfirmation } from './templates.js';
import type { Person } from './types.js';

export type Intent = 'stop' | 'yes' | 'no' | 'more' | 'sms_ok' | 'question' | 'unknown';

export interface Classification {
  intent: Intent;
  code?: string;
  /** Set with intent 'more' when the sender also consents to texts ("MORE TEXT OK"). */
  sms_ok?: boolean;
}

/** Remove quoted email history so we only classify what the person just wrote. */
export function stripQuoted(text: string): string {
  let t = text.replace(/\r\n?/g, '\n');
  t = t.replace(/^\s*On\b[\s\S]{0,300}?\bwrote:[\s\S]*$/im, '');
  t = t.replace(/^\s*-{2,}\s*Original Message\s*-{2,}[\s\S]*$/im, '');
  t = t.replace(/^\s*From:.*\n\s*Sent:[\s\S]*$/im, '');
  return t
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('>'))
    .join('\n')
    .trim();
}

const STOP_ANYWHERE = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE']);
const STOP_SHORT = new Set(['CANCEL', 'END', 'QUIT', 'OPTOUT']);

export function classifyReply(text: string): Classification {
  const clean = stripQuoted(text ?? '');
  const flat = clean.toUpperCase().replace(/['’`]/g, '');
  const tokens = flat.replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const joined = ` ${tokens.join(' ')} `;

  // 1. Opt-out wins over everything.
  if (
    tokens.some((t) => STOP_ANYWHERE.has(t)) ||
    (tokens.length <= 3 && tokens.some((t) => STOP_SHORT.has(t))) ||
    /\bOPT OUT\b/.test(joined) ||
    / REMOVE ME /.test(joined) ||
    / (DONT|DO NOT) (CONTACT|EMAIL|TEXT|MESSAGE) /.test(joined)
  ) {
    return { intent: 'stop' };
  }
  if (tokens.length === 0) return { intent: 'unknown' };

  // 2. Questions go to a human.
  if (clean.includes('?')) return { intent: 'question' };

  const first = tokens[0] ?? '';
  const hasMore = tokens.includes('MORE') && tokens.length <= 8;
  const smsOk =
    / TEXT OK /.test(joined) || / TEXTS? (ARE |IS )?OK(AY)? /.test(joined) ||
    / (YOU |U )?CAN TEXT ME /.test(joined) || / OK TO TEXT /.test(joined) || / SMS OK /.test(joined);

  // 3. More / SMS consent.
  if (hasMore) return smsOk ? { intent: 'more', sms_ok: true } : { intent: 'more' };
  if (smsOk && tokens.length <= 8) return { intent: 'sms_ok' };

  // 4. Yes (with optional code).
  if (['YES', 'Y', 'YEAH', 'YEP', 'YUP', 'ACCEPT'].includes(first) && tokens.length <= 4) {
    const origTokens = clean.replace(/['’`]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
    const code = origTokens.slice(1).find((t) => /\d/.test(t) && /^[A-Za-z0-9]+$/.test(t));
    return code ? { intent: 'yes', code } : { intent: 'yes' };
  }

  // 5. No.
  if (
    / NOT INTERESTED /.test(joined) ||
    / NO THANKS /.test(joined) ||
    (['NO', 'NOPE', 'NAH', 'PASS', 'DECLINE'].includes(first) && tokens.length <= 5)
  ) {
    return { intent: 'no' };
  }

  return { intent: 'unknown' };
}

// ---------- handling ----------

export interface InboundMessage {
  channel: 'email' | 'sms';
  from: string;
  text: string;
}

export type FindByContact = (c: { email?: string; phone?: string }) => Promise<Person[]>;

export interface HandleDeps {
  repo: Repo;
  /** Required for non-memory repos (the Repo interface has no lookup by contact). */
  findByContact?: FindByContact;
}

export type ReplyAction =
  | 'opted_out'
  | 'marked_regular'
  | 'accept_requested'
  | 'declined'
  | 'forward_to_ops'
  | 'ignored';

export interface HandleResult {
  intent: Intent;
  action: ReplyAction;
  matched_people: number;
  code?: string;
  sms_ok?: boolean;
  reply_text?: string;
}

/** Lookup over InMemoryRepo.people (tests, local dev). */
export function memoryFinder(repo: InMemoryRepo): FindByContact {
  return async ({ email, phone }) => {
    const e = normEmail(email ?? null);
    const p = toE164(phone ?? null);
    return [...repo.people.values()].filter((x) => (e && x.email === e) || (p && x.phone === p));
  };
}

/** Pull the bare address out of `Name <a@b.com>` and normalize it. */
function contactOf(msg: InboundMessage): { email?: string; phone?: string } {
  if (msg.channel === 'sms') {
    const phone = toE164(msg.from);
    return phone ? { phone } : {};
  }
  const angle = msg.from.match(/<([^>]+)>/);
  const email = normEmail(angle?.[1] ?? msg.from);
  return email ? { email } : {};
}

export async function handleReply(msg: InboundMessage, deps: HandleDeps): Promise<HandleResult> {
  const c = classifyReply(msg.text);
  const contact = contactOf(msg);
  const hasContact = Boolean(contact.email || contact.phone);

  if (c.intent === 'stop') {
    const matched = hasContact ? await deps.repo.optOut(contact) : 0;
    return { intent: 'stop', action: 'opted_out', matched_people: matched, reply_text: renderStopConfirmation() };
  }

  const finder: FindByContact = deps.findByContact ?? ((c) => deps.repo.findByContact(c));
  const people = hasContact && finder ? (await finder(contact)).filter((p) => !p.opted_out) : [];

  switch (c.intent) {
    case 'more':
    case 'sms_ok': {
      if (people.length === 0) return { intent: c.intent, action: 'forward_to_ops', matched_people: 0, ...(c.sms_ok ? { sms_ok: true } : {}) };
      for (const p of people) {
        if (c.intent === 'more') await deps.repo.setRegular(p.id, true, c.sms_ok ? true : undefined);
        else await deps.repo.setRegular(p.id, p.regular, true);
      }
      return {
        intent: c.intent,
        action: 'marked_regular',
        matched_people: people.length,
        ...(c.sms_ok ? { sms_ok: true } : {}),
        reply_text: "Thanks! We'll send you more jobs. Reply STOP anytime to opt out.",
      };
    }
    case 'yes':
      return { intent: 'yes', action: 'accept_requested', matched_people: people.length, ...(c.code ? { code: c.code } : {}) };
    case 'no':
      return { intent: 'no', action: 'declined', matched_people: people.length };
    default:
      return { intent: c.intent, action: 'forward_to_ops', matched_people: people.length };
  }
}
