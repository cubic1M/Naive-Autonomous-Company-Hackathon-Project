/**
 * Outreach message copy. OWNED BY the messaging workstream; send_blast only calls these functions.
 * Plain text only, no tracking pixels. Every message carries an opt-out.
 */
import type { JobForOutreach, Person } from './types.js';

export interface MessageContext {
  job: JobForOutreach;
  person: Person;
  /** Signed job link: `${PUBLIC_BASE_URL}/j/${token}` */
  link: string;
  /** What the worker earns, USD. */
  payUsd: number;
}

export interface EmailMessage {
  subject: string;
  text: string;
}

export const EMAIL_FOOTER = 'Reply STOP to never hear from us again.';
export const SMS_MAX = 320;

export function workerPay(job: JobForOutreach): number {
  return Math.round((job.worker_pay_usd ?? job.budget_usd * 0.75) * 100) / 100;
}

function money(usd: number): string {
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`;
}

/** e.g. "Sat Nov 8, 2:00 PM" in Pacific time; null if missing/invalid. */
export function formatDeadline(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('month')} ${get('day')}, ${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
}

function whyLine(person: Person): string {
  return person.regular
    ? 'You asked us to send you jobs.'
    : person.kind === 'business'
      ? 'We found your business listing publicly online.'
      : 'We found your public profile online.';
}

export function renderEmail(ctx: MessageContext): EmailMessage {
  const { job, person } = ctx;
  const pay = money(ctx.payUsd);
  const when = formatDeadline(job.deadline);
  const lines = [
    `Hi${person.name ? ` ${person.name}` : ''},`,
    '',
    'Operis connects local people with paid short jobs from businesses.',
    '',
    `The job: ${job.title}`,
    ...(job.address ? [`Where: ${job.address}`] : []),
    ...(when ? [`When: by ${when} (Pacific time)`] : []),
    `Pay: ${pay}`,
    ...(job.certification_required ? [`Requires: ${job.certification_required}`] : []),
    '',
    whyLine(person),
    '',
    `See details and accept: ${ctx.link}`,
    'First to accept gets it. No signup.',
    '',
    EMAIL_FOOTER,
  ];
  return { subject: `${job.title}: ${pay} paid gig near you`, text: lines.join('\n') };
}

/** Max 320 chars (2 SMS segments). Only ever sent to regulars with sms_consent. */
export function renderSms(ctx: MessageContext): string {
  const build = (title: string) =>
    `Operis: paid gig near you, ${title}, ${money(ctx.payUsd)}. Accept: ${ctx.link} Reply STOP to opt out.`;
  const title = ctx.job.title.replace(/\s+/g, ' ').trim();
  let out = build(title);
  if (out.length <= SMS_MAX) return out;
  const overhead = build('').length;
  const room = Math.max(0, SMS_MAX - overhead - 1);
  out = build(`${title.slice(0, room).trimEnd()}…`);
  // Pathological link length: hard cap, keeping the opt-out intact is impossible then, so cut the title fully.
  return out.length <= SMS_MAX ? out : build('').slice(0, SMS_MAX);
}

export function renderRegularInvite(ctx: { person: Person; jobTitle: string }): { email: EmailMessage } {
  const { person, jobTitle } = ctx;
  return {
    email: {
      subject: 'Thanks! Want more gigs like this?',
      text: [
        `Hi${person.name ? ` ${person.name}` : ''},`,
        '',
        `Thanks for completing "${jobTitle}" with Operis. Operis connects local people with paid short jobs from businesses.`,
        '',
        'Want more gigs like this? Reply MORE (and add TEXT OK if we may text you).',
        '',
        EMAIL_FOOTER,
      ].join('\n'),
    },
  };
}

export function renderStopConfirmation(): string {
  return "You're unsubscribed. We won't contact you again.";
}
