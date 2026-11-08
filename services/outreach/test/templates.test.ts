import { describe, expect, it } from 'vitest';
import { formatDeadline, renderDm, renderEmail, renderRegularInvite, renderSms, renderStopConfirmation, workerPay } from '../src/templates.js';
import type { JobForOutreach, Person } from '../src/types.js';

const job: JobForOutreach = {
  id: 'j1', title: 'Hold a sign near the YC office', instructions: 'x', address: '335 Pioneer Way, Mountain View',
  lat: 1, lng: 2, deadline: '2026-11-08T22:00:00Z', budget_usd: 60, worker_pay_usd: 45, certification_required: null, remote: false, status: 'open',
};
const person = (o: Partial<Person> = {}): Person => ({
  id: 'p1', name: 'Sam', email: 's@x.com', phone: null, source: 's', opted_out: false, kind: 'business', website: null,
  profile_url: null, address: null, lat: null, lng: null, categories: [], rating: null, snippet: null, regular: false,
  sms_consent: false, last_contacted_at: null, dedupe_key: 'k', profiles: [], headline: null, location_text: null,
  credentials: [], open_to_work: false, last_active_at: null, ...o,
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
    expect(m.text).toContain('Operis matches businesses with skilled people for short, paid jobs');
    expect(m.html).toContain('View job &amp; accept');
    expect(m.html).toContain('STOP');
    expect(m.text).toContain('Sun Nov 8, 2:00 PM');
    expect(m.text).toContain('https://operis.test/j/abc123');
    expect(m.text).toContain('The first qualified person to accept gets the job');
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

  describe('remote + profile wording', () => {
    const remote = { ...job, remote: true, address: null, title: 'Review a SaaS terms-of-service' };
    const lawyer = person({ kind: 'person', name: 'Jane Doe', headline: 'Freelance contract attorney', profiles: [{ platform: 'linkedin', url: 'https://www.linkedin.com/in/jane', handle: 'jane' }] });

    it('email says Remote for remote jobs', () => {
      const m = renderEmail(ctx(remote, lawyer));
      expect(m.text).toContain('Where: Remote');
      expect(m.subject.toLowerCase()).toContain('remote');
      expect(m.subject).not.toContain('near you');
    });
    it('whyLine names the platform and headline', () => {
      const t = renderEmail(ctx(job, lawyer)).text;
      expect(t).toContain('We found your public profile (LinkedIn) where you list Freelance contract attorney.');
      const bare = renderEmail(ctx(job, person({ kind: 'person', profiles: [{ platform: 'github', url: 'https://github.com/x', handle: 'x' }] }))).text;
      expect(bare).toContain('We found your public profile (GitHub).');
    });
  });

  describe('renderDm', () => {
    const link = `https://operis.test/j/${'a'.repeat(60)}`;
    const realLink = `https://operis.vercel.app/j/${'a'.repeat(206)}`;
    const dmCtx = (j = job, p = person({ kind: 'person', name: 'Jane Doe', headline: 'Freelance contract attorney' })) => ({ job: j, person: p, link, payUsd: workerPay(j) });

    it('is personal, honest, includes link, pay and opt-out, within 300 chars', () => {
      for (const platform of ['linkedin', 'x', 'reddit', 'instagram'] as const) {
        const dm = renderDm(dmCtx(), platform);
        expect(dm.length).toBeLessThanOrEqual(300);
        expect(dm).toContain('Hi Jane,');
        expect(dm).toContain('Operis');
        expect(dm).toContain('$45');
        expect(dm).toContain(link);
        expect(dm).toContain("Not interested? Just say so and we won't message again.");
        expect(dm).toContain('Freelance contract attorney');
      }
    });
    it('with a real 234-char signed link: copy <= 300, whole DM <= 500', () => {
      const c = { ...dmCtx(), link: realLink };
      for (const j of [job, { ...job, title: 'T'.repeat(400), remote: true }]) {
        const dm = renderDm({ ...c, job: j }, 'x');
        expect(dm.length).toBeLessThanOrEqual(500);
        expect(dm.length - realLink.length).toBeLessThanOrEqual(300);
        expect(dm).toContain(realLink);
        expect(dm).toContain("we won't message again.");
      }
    });
    it('says Remote for remote jobs, address otherwise', () => {
      expect(renderDm(dmCtx({ ...job, remote: true, address: null }), 'x')).toContain('Remote');
      expect(renderDm({ ...dmCtx(), link: realLink }, 'x')).toContain('Mountain View');
    });
    it('shrinks long titles/headlines but keeps link and opt-out', () => {
      const long = { ...job, title: 'T'.repeat(400) };
      const dm = renderDm(dmCtx(long, person({ kind: 'person', name: null, headline: 'H'.repeat(300) })), 'linkedin');
      expect(dm.length).toBeLessThanOrEqual(300);
      expect(dm).toContain(link);
      expect(dm).toContain("we won't message again.");
      expect(dm.startsWith('Hi,')).toBe(true);
    });
  });
});

describe('greeting names', () => {
  it('capitalizes lowercase person names but keeps business names and mixed case', async () => {
    const { displayName, greetingName } = await import('../src/templates.js');
    expect(displayName('andrea greenberg')).toBe('Andrea Greenberg');
    expect(displayName('Isaih Owens, Esq.')).toBe('Isaih Owens, Esq.');
    expect(displayName('ruchika McDonald')).toBe('Ruchika McDonald');
    expect(greetingName({ name: 'andrea greenberg', kind: 'person' })).toBe('Andrea');
    expect(greetingName({ name: 'attack! event staffing', kind: 'business' })).toBe('attack! event staffing');
  });
});

describe('urgencyLabel', () => {
  it('says Today / Tomorrow / a date / Open now (Pacific time)', async () => {
    const { urgencyLabel } = await import('../src/templates.js');
    const now = new Date('2026-11-08T18:00:00Z'); // Sun 10am PT
    expect(urgencyLabel('2026-11-08T23:00:00Z', now)).toBe('Today');
    expect(urgencyLabel('2026-11-09T20:00:00Z', now)).toBe('Tomorrow');
    expect(urgencyLabel('2026-11-12T20:00:00Z', now)).toBe('Thu Nov 12');
    expect(urgencyLabel(null, now)).toBe('Open now');
    expect(urgencyLabel('2026-11-01T00:00:00Z', now)).toBe('Open now');
  });
});
