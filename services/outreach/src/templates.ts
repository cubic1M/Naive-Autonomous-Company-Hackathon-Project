/**
 * Outreach message copy. OWNED BY the messaging workstream; send_blast only calls these functions.
 * Plain text only, no tracking pixels. Every message carries an opt-out.
 */
import type { JobForOutreach, ManualPlatform, Person, Profile } from './types.js';

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

const PLATFORM_LABEL: Record<string, string> = {
  linkedin: 'LinkedIn',
  github: 'GitHub',
  x: 'X',
  reddit: 'Reddit',
  instagram: 'Instagram',
  website: 'website',
  directory: 'directory listing',
};

/** The profile we mention as "where we found you": social first, personal site last. */
function foundOn(profiles: Profile[]): Profile | null {
  for (const pl of ['linkedin', 'github', 'x', 'reddit', 'instagram', 'directory', 'website']) {
    const hit = profiles.find((p) => p.platform === pl);
    if (hit) return hit;
  }
  return null;
}

function whyLine(person: Person): string {
  if (person.regular) return 'You asked us to send you jobs.';
  const on = foundOn(person.profiles ?? []);
  if (on && person.kind === 'person') {
    const label = PLATFORM_LABEL[on.platform] ?? 'online';
    const lists = person.headline ? ` where you list ${person.headline.replace(/\s+/g, ' ').trim()}` : '';
    return `We found your public profile (${label})${lists}.`;
  }
  return person.kind === 'business' ? 'We found your business listing publicly online.' : 'We found your public profile online.';
}

function whereLine(job: JobForOutreach): string | null {
  if (job.remote) return 'Remote (work online from anywhere)';
  return job.address;
}

export function renderEmail(ctx: MessageContext): EmailMessage {
  const { job, person } = ctx;
  const pay = money(ctx.payUsd);
  const when = formatDeadline(job.deadline);
  const lines = [
    `Hi${person.name ? ` ${person.name}` : ''},`,
    '',
    'Operis connects people with paid short jobs from businesses.',
    '',
    `The job: ${job.title}`,
    ...(whereLine(job) ? [`Where: ${whereLine(job)}`] : []),
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
  return { subject: job.remote ? `${job.title}: ${pay} paid remote gig` : `${job.title}: ${pay} paid gig near you`, text: lines.join('\n') };
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

/** Max chars of DM copy (everything except the link) for a LinkedIn connection note. */
export const DM_MAX = 300;
/** X, Reddit and Instagram DM limit; the whole DM, link included, stays under it. */
export const DM_TOTAL_MAX = 500;
export const DM_OPT_OUT = "Not interested? Just say so and we won't message again.";

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (max <= 0) return '';
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * A short personal DM for a teammate to send by hand on `platform`. The copy (without the link) is <= 300
 * chars, and the whole DM stays <= 500 (X/Reddit/Instagram) for links up to ~340 chars. With a link <= ~100
 * chars the whole DM also fits a 300-char LinkedIn connection note; signed links are longer, so for
 * LinkedIn use InMail (Recruiter Lite) or a short link. The link and opt-out are never cut, the rest shrinks.
 */
export function renderDm(ctx: MessageContext, _platform: ManualPlatform): string {
  const { job, person } = ctx;
  const first = person.name?.trim().split(/\s+/)[0];
  const pay = money(ctx.payUsd);
  const where = job.remote ? 'Remote' : (job.address ?? '').split(',').slice(0, 2).join(',').trim();
  const headline = person.headline?.replace(/\s+/g, ' ').trim() ?? '';
  const budget = ctx.link.length <= 100 ? DM_MAX - ctx.link.length : Math.max(160, Math.min(DM_MAX, DM_TOTAL_MAX - ctx.link.length));
  const build = (title: string, why: string, place: string): string =>
    [
      `Hi${first ? ` ${first}` : ''}, Operis here, we connect people with paid short jobs.${why ? ` ${why}` : ''}`,
      `Job: ${title}${place ? `, ${place}` : ''}, ${pay}. Details: ${ctx.link}`,
      DM_OPT_OUT,
    ].join(' ');
  const copyLen = (text: string) => text.length - ctx.link.length;
  const whyFull = headline ? `Saw your profile (${clip(headline, 45)}).` : '';
  const title = job.title.replace(/\s+/g, ' ').trim();
  for (const [why, place] of [
    [whyFull, where],
    [whyFull, job.remote ? 'Remote' : ''],
    ['', where],
    ['', job.remote ? 'Remote' : ''],
  ] as const) {
    const room = budget - copyLen(build('', why, place));
    if (room >= Math.min(title.length, 24)) return build(clip(title, room), why, place);
  }
  return build(clip(title, 20), '', '');
}

export function renderRegularInvite(ctx: { person: Person; jobTitle: string }): { email: EmailMessage } {
  const { person, jobTitle } = ctx;
  return {
    email: {
      subject: 'Thanks! Want more gigs like this?',
      text: [
        `Hi${person.name ? ` ${person.name}` : ''},`,
        '',
        `Thanks for completing "${jobTitle}" with Operis. Operis connects people with paid short jobs from businesses.`,
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
