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

/** Short urgency for the hero: "Today" / "Tomorrow" / "Sun Nov 8" (Pacific time), or "Open now". */
export function urgencyLabel(deadline: string | null, now: Date = new Date()): string {
  if (!deadline) return 'Open now';
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return 'Open now';
  const day = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(x);
  if (d.getTime() < now.getTime()) return 'Open now';
  if (day(d) === day(now)) return 'Today';
  if (day(d) === day(new Date(now.getTime() + 24 * 3600 * 1000))) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric' }).format(d).replace(',', '');
}

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
 * Branded HTML version, "editorial" style (cream page, serif headings, sage green, soft beige cards,
 * pill buttons). Table layout + inline styles for Gmail/Outlook/Apple Mail. No images or tracking
 * pixels (they hurt deliverability and trust): the green hero is a CSS gradient with a solid fallback.
 */
export function renderEmailHtml(ctx: MessageContext): string {
  const { job, person } = ctx;
  const pay = money(ctx.payUsd);
  const when = formatDeadline(job.deadline);
  const where = whereLine(job);
  const name = greetingName(person);
  const C = {
    page: '#fbfaf6',
    card: '#f0eee8',
    ink: '#2f3a33',
    body: '#4a514c',
    muted: '#8a8f8a',
    sage: '#19211a', // brand green (buttons)
    label: '#4b5e4f',
    deep: '#19211a', // brand green (hero)
  };
  const serif = "Georgia,'Times New Roman',Times,serif";
  const sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  const pill = (label: string, wide = false) =>
    `<a href="${esc(ctx.link)}" style="display:inline-block;background:${C.sage};background-image:linear-gradient(180deg,#34453a 0%,#19211a 100%);border:1px solid #0e130f;color:#f4f1e8;text-decoration:none;font-family:${sans};font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;padding:${wide ? '15px 44px' : '11px 34px'};border-radius:999px">${esc(label)}</a>`;
  const detail = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;font-family:${sans};font-size:13px;color:${C.muted};white-space:nowrap;vertical-align:top">${esc(label)}</td><td style="padding:4px 0;font-family:${sans};font-size:14px;color:${C.ink}">${esc(value)}</td></tr>`;
  const details = [
    ...(where ? [detail(job.remote ? 'Location' : 'Where', where)] : []),
    ...(when ? [detail('Due', `${when} (PT)`)] : []),
    detail('Pay', `${pay}, paid when the work is approved`),
    ...(job.certification_required ? [detail('Requires', job.certification_required)] : []),
  ].join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(job.title)}</title></head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden">${esc(`${job.title} · ${pay}. The first qualified person to accept gets it.`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:24px 12px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">

  <tr><td align="center" style="padding:6px 0 18px;font-family:${serif};font-size:19px;font-weight:700;color:${C.ink}">Operis</td></tr>

  <tr><td bgcolor="${C.deep}" align="center" style="background:${C.deep};background-image:radial-gradient(ellipse at 18% 12%,rgba(214,226,206,0.16) 0%,rgba(214,226,206,0) 55%),linear-gradient(135deg,#3b4f3f 0%,#243026 45%,#19211a 75%,#0e130f 100%);border-radius:16px;padding:56px 28px">
    <div style="font-family:${sans};font-size:12px;font-weight:700;letter-spacing:2.4px;text-transform:uppercase;color:#cfd9cc;margin-bottom:14px">${esc(`${pay} · ${urgencyLabel(job.deadline)}`)}</div>
    <div style="font-family:${serif};font-size:44px;line-height:1.1;color:#ffffff">You've been<br>selected</div>
  </td></tr>

  <tr><td align="center" style="padding:22px 20px 26px;font-family:${sans};font-size:16px;line-height:1.5;color:${C.body}">
    Hi${name ? ` ${esc(name)}` : ''}, a short, paid job just opened up.<br>The first qualified person to accept gets it.
  </td></tr>

  <tr><td style="background:${C.card};border-radius:16px;padding:28px 30px" align="center">
    <div style="font-family:${sans};font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${C.label};margin-bottom:8px">${job.remote ? 'Remote job' : 'On-site job'}</div>
    <div style="font-family:${serif};font-size:25px;line-height:1.25;color:${C.ink};margin-bottom:14px">${esc(job.title)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px;text-align:left">${details}</table>
    ${pill('View job & accept')}
  </td></tr>

  <tr><td style="height:32px;line-height:32px;font-size:0">&nbsp;</td></tr>
</table>
</td></tr>
<tr><td align="center" style="background:${C.card};padding:26px 16px 30px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td style="padding:0 18px">
    <div style="font-family:${serif};font-size:21px;font-weight:700;color:${C.ink};margin-bottom:10px">Operis</div>
    <div style="font-family:${sans};font-size:12px;line-height:1.6;color:${C.muted}">
      Why you got this: ${esc(whyLine(person))}<br>
      ${esc(COMPANY.address)} · <a href="https://${COMPANY.site}" style="color:${C.muted}">${COMPANY.site}</a><br>
      Not interested? Reply <strong>STOP</strong> and we'll never contact you again.
    </div>
  </td></tr></table>
</td></tr>
</table>
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
