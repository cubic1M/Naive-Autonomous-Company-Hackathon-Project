import { describe, expect, it } from 'vitest';
import { formatDeadline, renderEmail, renderRegularInvite, renderSms, renderStopConfirmation, workerPay } from '../src/templates.js';
import type { JobForOutreach, Person } from '../src/types.js';

const job: JobForOutreach = {
  id: 'j1', title: 'Hold a sign near the YC office', instructions: 'x', address: '335 Pioneer Way, Mountain View',
  lat: 1, lng: 2, deadline: '2026-11-08T22:00:00Z', budget_usd: 60, worker_pay_usd: 45, certification_required: null, status: 'open',
};
const person = (o: Partial<Person> = {}): Person => ({
  id: 'p1', name: 'Sam', email: 's@x.com', phone: null, source: 's', opted_out: false, kind: 'business', website: null,
  profile_url: null, address: null, lat: null, lng: null, categories: [], rating: null, snippet: null, regular: false,
  sms_consent: false, last_contacted_at: null, dedupe_key: 'k', ...o,
});
const ctx = (j = job, p = person()) => ({ job: j, person: p, link: 'https://operis.test/j/abc123', payUsd: workerPay(j) });

describe('templates', () => {
  it('workerPay falls back to 75% of budget', () => {
    expect(workerPay({ ...job, worker_pay_usd: null })).toBe(45);
    expect(workerPay(job)).toBe(45);
  });
  it('formats deadline in Pacific time', () => {
    expect(formatDeadline('2026-11-08T22:00:00Z')).toBe('Sun Nov 8, 2:00 PM');
    expect(formatDeadline('2026-11-08T22:00:00Z')).not.toBeNull();
    expect(formatDeadline(null)).toBeNull();
    expect(formatDeadline('nope')).toBeNull();
  });
  it('email has subject with task and pay, footer, link, deadline', () => {
    const m = renderEmail(ctx());
    expect(m.subject).toContain('Hold a sign');
    expect(m.subject).toContain('$45');
    expect(m.text).toContain('Operis connects local people with paid short jobs from businesses');
    expect(m.text).toContain('Sun Nov 8, 2:00 PM');
    expect(m.text).toContain('https://operis.test/j/abc123');
    expect(m.text).toContain('First to accept gets it');
    expect(m.text.trimEnd().endsWith('Reply STOP to never hear from us again.')).toBe(true);
    expect(m.text).not.toMatch(/<img|https?:\/\/[^\s]*pixel/i);
  });
  it('omits deadline and cert when absent, shows cert when required', () => {
    const none = renderEmail(ctx({ ...job, deadline: null }));
    expect(none.text).not.toContain('When:');
    expect(none.text).not.toContain('Requires:');
    const cert = renderEmail(ctx({ ...job, certification_required: 'Food handler card' }));
    expect(cert.text).toContain('Requires: Food handler card');
  });
  it('business vs regular wording', () => {
    expect(renderEmail(ctx()).text).toContain('We found your business listing publicly online');
    const reg = renderEmail(ctx(job, person({ regular: true })));
    expect(reg.text).toContain('You asked us to send you jobs');
    expect(reg.text).not.toContain('business listing');
  });
  it('SMS under cap with long title, keeps link and STOP', () => {
    expect(renderSms(ctx({ ...job, title: 'A'.repeat(200) })).length).toBeLessThanOrEqual(320);
    const long = { ...job, title: 'A'.repeat(500) };
    const s = renderSms(ctx(long));
    expect(s.length).toBeLessThanOrEqual(320);
    expect(s).toContain('https://operis.test/j/abc123');
    expect(s).toContain('Reply STOP to opt out');
    expect(s).toContain('…');
  });
  it('SMS short title is untruncated', () => {
    const s = renderSms(ctx());
    expect(s).toContain(job.title);
    expect(s).toContain('$45');
    expect(s).not.toContain('…');
  });
  it('regular invite and stop confirmation', () => {
    const { email } = renderRegularInvite({ person: person(), jobTitle: 'Sign job' });
    expect(email.text).toContain('Reply MORE');
    expect(email.text).toContain('TEXT OK');
    expect(email.text).toContain('Sign job');
    expect(email.text).toContain('Reply STOP');
    expect(renderStopConfirmation()).toBe("You're unsubscribed. We won't contact you again.");
  });
});
