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
  /** Branded HTML version (senders that support it send both; text stays the fallback). */
  html?: string;
}

export const EMAIL_FOOTER = 'Reply STOP to never hear from us again.';
export const SMS_MAX = 320;

/** Display name for greetings: "andrea greenberg" -> "Andrea Greenberg"; keeps "McDonald", "DeSantis", "Esq."; businesses untouched. */
export function displayName(name: string | null, kind: 'person' | 'business' = 'person'): string | null {
  if (!name) return null;
  const n = name.replace(/\s+/g, ' ').trim();
  if (!n) return null;
  if (kind === 'business') return n;
  return n
    .split(' ')
    .map((w) => (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** First name for a person's greeting, null for businesses with no person name. */
export function greetingName(person: { name: string | null; kind: 'person' | 'business' }): string | null {
  const d = displayName(person.name, person.kind);
  if (!d) return null;
  return person.kind === 'person' ? d.split(' ')[0]! : d;
}

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

/** Company identity shown in every email footer (CAN-SPAM: who we are + a postal address + opt-out). */
export const COMPANY = {
  name: 'Operis',
  site: 'operis.live',
  tagline: 'Verified people for short paid jobs',
  // TODO(team): replace with Operis's real mailing address before OUTREACH_LIVE=true (legally required).
  address: 'Operis · San Francisco, CA',
} as const;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Subject: calm and specific, like a real company (no "gig near you", no all-caps, pay at the end). */
export function emailSubject(job: JobForOutreach, payUsd: number): string {
  return `${job.remote ? 'Remote opportunity' : 'Opportunity'}: ${job.title} · ${money(payUsd)}`;
}

export function renderEmail(ctx: MessageContext): EmailMessage {
  const { job, person } = ctx;
  const pay = money(ctx.payUsd);
  const when = formatDeadline(job.deadline);
  const where = whereLine(job);
  const name = greetingName(person);
  const lines = [
    `Hi${name ? ` ${name}` : ''},`,
    '',
    `${COMPANY.name} matches businesses with skilled people for short, paid jobs. A new one fits your background:`,
    '',
    `  ${job.title}`,
    ...(where ? [`  Where: ${where}`] : []),
    ...(when ? [`  Due: ${when} (Pacific time)`] : []),
    `  Pay: ${pay}, paid by ${COMPANY.name} when the work is approved`,
    ...(job.certification_required ? [`  Requires: ${job.certification_required}`] : []),
    '',
    `View the job and accept: ${ctx.link}`,
    '',
    'The first qualified person to accept gets the job. No account or signup needed.',
    '',
    `Why you got this: ${whyLine(person)}`,
    '',
    `${COMPANY.name} · ${COMPANY.site}`,
    COMPANY.address,
    EMAIL_FOOTER,
  ];
  return { subject: emailSubject(job, ctx.payUsd), text: lines.join('\n'), html: renderEmailHtml(ctx) };
}

/**
 * Branded HTML version. Table layout + inline styles (works in Gmail/Outlook/Apple Mail), no images
 * (images and tracking pixels hurt deliverability and trust), one clear button, a real footer.
 */
export function renderEmailHtml(ctx: MessageContext): string {
  const { job, person } = ctx;
  const pay = money(ctx.payUsd);
  const when = formatDeadline(job.deadline);
  const where = whereLine(job);
  const name = greetingName(person);
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:96px;vertical-align:top">${esc(label)}</td><td style="padding:6px 0;color:#111827;font-size:14px;font-weight:500">${esc(value)}</td></tr>`;
  const details = [
    ...(where ? [row(job.remote ? 'Location' : 'Where', where)] : []),
    ...(when ? [row('Due', `${when} (PT)`)] : []),
    row('Pay', `${pay}, paid on approval`),
    ...(job.certification_required ? [row('Requires', job.certification_required)] : []),
  ].join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(job.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden">${esc(`${job.title} · ${pay}. First qualified person to accept gets it.`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb">
  <tr><td style="padding:22px 28px;border-bottom:1px solid #f0f1f3">
    <span style="font-size:18px;font-weight:700;letter-spacing:-0.2px;color:#111827">${COMPANY.name}</span>
    <span style="font-size:12px;color:#6b7280;padding-left:8px">${esc(COMPANY.tagline)}</span>
  </td></tr>
  <tr><td style="padding:28px 28px 8px">
    <p style="margin:0 0 14px;font-size:15px;color:#111827">Hi${name ? ` ${esc(name)}` : ''},</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#374151">${COMPANY.name} matches businesses with skilled people for short, paid jobs. A new one fits your background:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px">
      <tr><td style="padding:18px 20px">
        <div style="font-size:12px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;color:#4f46e5;margin-bottom:6px">${job.remote ? 'Remote job' : 'On-site job'}</div>
        <div style="font-size:17px;font-weight:650;color:#111827;margin-bottom:10px;line-height:1.35">${esc(job.title)}</div>
        <table role="presentation" cellpadding="0" cellspacing="0">${details}</table>
      </td></tr>
    </table>
  </td></tr>
  <tr><td align="center" style="padding:22px 28px 6px">
    <a href="${esc(ctx.link)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 28px;border-radius:8px">View job &amp; accept</a>
    <p style="margin:12px 0 0;font-size:13px;color:#6b7280">The first qualified person to accept gets the job. No account needed.</p>
  </td></tr>
  <tr><td style="padding:20px 28px 26px">
    <p style="margin:0;font-size:12px;line-height:1.5;color:#9ca3af">Why you got this: ${esc(whyLine(person))}</p>
  </td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td align="center" style="padding:16px 12px;font-size:12px;line-height:1.6;color:#9ca3af">
  ${COMPANY.name} · <a href="https://${COMPANY.site}" style="color:#9ca3af">${COMPANY.site}</a> · ${esc(COMPANY.address.replace(/^Operis · /, ''))}<br>
  Not interested? Reply <strong>STOP</strong> and we'll never contact you again.
</td></tr></table>
</td></tr></table>
</body></html>`;
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
  const first = greetingName(person);
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
        `Hi${greetingName(person) ? ` ${greetingName(person)}` : ''},`,
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
