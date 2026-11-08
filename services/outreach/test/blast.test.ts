import { describe, expect, it } from 'vitest';
import { sendBlast, sendBlastDetailed } from '../src/blast.js';
import type { Env } from '../src/env.js';
import { InMemoryRepo } from '../src/repo/memory.js';
import { RecordingSender } from '../src/senders.js';
import { verifyJobToken } from '../src/tokens.js';

const env = (o: Partial<Env> = {}): Env => ({
  MONID_API_KEY: 'k', MONID_BASE_URL: 'x', PUBLIC_BASE_URL: 'https://app.test', LINK_SIGNING_SECRET: 'sek',
  NAIVE_BASE_URL: 'x', OUTREACH_MAX_SPEND_USD: 1, OUTREACH_RADIUS_KM: 8, OUTREACH_LIVE: false,
  OUTREACH_TEST_ALLOWLIST: [], PAUSE_OUTREACH: false, OUTREACH_MANUAL_DAILY_CAP: 20, OUTREACH_MANUAL_QUEUE: true, ...o,
});

function setup(status = 'held') {
  const repo = new InMemoryRepo();
  repo.addJob({ id: 'job1', title: 'Photo', instructions: 'x', address: null, lat: null, lng: null, deadline: null, budget_usd: 40, worker_pay_usd: 30, certification_required: null, remote: false, status });
  const a = repo.addPerson({ id: 'a', dedupe_key: 'a', email: 'a@x.com' });
  const b = repo.addPerson({ id: 'b', dedupe_key: 'b', email: 'b@x.com' });
  const out = repo.addPerson({ id: 'o', dedupe_key: 'o', email: 'o@x.com', opted_out: true });
  const reg = repo.addPerson({ id: 'r', dedupe_key: 'r', email: 'r@x.com', phone: '4155550142', regular: true, sms_consent: true });
  const nochan = repo.addPerson({ id: 'n', dedupe_key: 'n' });
  return { repo, a, b, out, reg, nochan, email: new RecordingSender(), sms: new RecordingSender() };
}

describe('sendBlast', () => {
  it('dry-runs by default: records rows, sends nothing, sent=0', async () => {
    const s = setup();
    const r = await sendBlastDetailed({ job_id: 'job1', candidate_ids: ['a', 'b'] }, { repo: s.repo, env: env(), email: s.email });
    expect(r.sent).toBe(0);
    expect(r.dry_run).toBe(2);
    expect(r.outreach_ids).toHaveLength(2);
    expect(s.email.sent).toHaveLength(0);
    expect((await s.repo.listOutreachForJob('job1')).every((o) => o.status === 'dry_run')).toBe(true);
  });

  it('sends live to everyone when OUTREACH_LIVE', async () => {
    const s = setup();
    const r = await sendBlast({ job_id: 'job1', candidate_ids: ['a', 'b'] }, { repo: s.repo, env: env({ OUTREACH_LIVE: true }), email: s.email });
    expect(r.sent).toBe(2);
    expect(s.email.sent.map((m) => m.to).sort()).toEqual(['a@x.com', 'b@x.com']);
    expect(s.a.last_contacted_at).not.toBeNull();
    const rows = await s.repo.listOutreachForJob('job1');
    const link = s.email.sent[0]!.body.match(/\/j\/(\S+)/)![1]!;
    const claims = verifyJobToken(link, 'sek');
    expect(claims?.job_id).toBe('job1');
    expect(rows.map((o) => o.token)).toContain(link);
  });

  it('allowlist sends only to allowlisted contacts (case-insensitive)', async () => {
    const s = setup();
    const r = await sendBlastDetailed({ job_id: 'job1', candidate_ids: ['a', 'b'] }, { repo: s.repo, env: env({ OUTREACH_TEST_ALLOWLIST: ['a@x.com'] }), email: s.email });
    expect(r.sent).toBe(1);
    expect(r.dry_run).toBe(1);
    expect(s.email.sent.map((m) => m.to)).toEqual(['a@x.com']);
    expect(r.outreach_ids).toHaveLength(2);
  });

  it('counts opted-out, skips unknown and no-channel', async () => {
    const s = setup();
    const r = await sendBlastDetailed({ job_id: 'job1', candidate_ids: ['o', 'zzz', 'n', 'a'] }, { repo: s.repo, env: env({ OUTREACH_LIVE: true }), email: s.email });
    expect(r.skipped_opted_out).toBe(1);
    expect(r.sent).toBe(1);
    expect(r.results.map((x) => x.status)).toEqual(['skipped_opted_out', 'skipped_unknown', 'skipped_no_channel', 'sent']);
  });

  it('never double-sends, and dedupes ids', async () => {
    const s = setup();
    const d = { repo: s.repo, env: env({ OUTREACH_LIVE: true }), email: s.email };
    expect((await sendBlast({ job_id: 'job1', candidate_ids: ['a', 'a'] }, d)).sent).toBe(1);
    const again = await sendBlast({ job_id: 'job1', candidate_ids: ['a', 'b'] }, d);
    expect(again.sent).toBe(1);
    expect(s.email.sent.filter((m) => m.to === 'a@x.com')).toHaveLength(1);
  });

  it('SMS only for consenting regulars; cost recorded', async () => {
    const s = setup();
    const sms = { send: async (to: string, body: string) => ({ ...(await s.sms.send(to, body)), cost_usd: 0.01 }) };
    await sendBlast({ job_id: 'job1', candidate_ids: ['a', 'r'] }, { repo: s.repo, env: env({ OUTREACH_LIVE: true }), email: s.email, sms });
    expect(s.sms.sent.map((m) => m.to)).toEqual(['+14155550142']);
    expect(s.email.sent.map((m) => m.to)).toEqual(['a@x.com']);
    expect(s.repo.costs).toHaveLength(1);
    expect(s.repo.costs[0]).toMatchObject({ kind: 'sms_cost', amount_usd: 0.01, job_id: 'job1' });
  });

  it('falls back to email when no SMS sender; skips if no email', async () => {
    const s = setup();
    s.repo.addPerson({ id: 'r2', dedupe_key: 'r2', phone: '4155550143', regular: true, sms_consent: true });
    const r = await sendBlastDetailed({ job_id: 'job1', candidate_ids: ['r', 'r2'] }, { repo: s.repo, env: env({ OUTREACH_LIVE: true }), email: s.email });
    expect(r.sent).toBe(1);
    expect(s.email.sent.map((m) => m.to)).toEqual(['r@x.com']);
    expect(r.results[1]!.status).toBe('skipped_no_channel');
    expect((await s.repo.listOutreachForJob('job1'))[0]!.channel).toBe('email');
  });

  it('isolates failures', async () => {
    const s = setup();
    const email = new RecordingSender((to) => to === 'a@x.com');
    const r = await sendBlastDetailed({ job_id: 'job1', candidate_ids: ['a', 'b'] }, { repo: s.repo, env: env({ OUTREACH_LIVE: true }), email });
    expect(r.sent).toBe(1);
    expect(r.failed).toBe(1);
    const rows = await s.repo.listOutreachForJob('job1');
    expect(rows.find((o) => o.worker_id === 'a')!.status).toBe('failed');
    expect(s.a.last_contacted_at).toBeNull();
  });

  it('pause switch sends nothing and does not even need the job', async () => {
    const s = setup();
    const r = await sendBlast({ job_id: 'nope', candidate_ids: ['a'] }, { repo: s.repo, env: env({ PAUSE_OUTREACH: true, OUTREACH_LIVE: true }), email: s.email });
    expect(r).toEqual({ sent: 0, skipped_opted_out: 0, queued_manual: 0, outreach_ids: [] });
    expect(s.email.sent).toHaveLength(0);
  });

  it('rejects wrong job status and missing job', async () => {
    const s = setup('requested');
    const d = { repo: s.repo, env: env(), email: s.email };
    await expect(sendBlast({ job_id: 'job1', candidate_ids: ['a'] }, d)).rejects.toThrow(/requested/);
    await expect(sendBlast({ job_id: 'zzz', candidate_ids: ['a'] }, d)).rejects.toThrow(/not found/);
  });

  it('caps at 50 per call', async () => {
    const s = setup();
    const ids: string[] = [];
    for (let i = 0; i < 60; i++) ids.push(s.repo.addPerson({ dedupe_key: `p${i}`, email: `p${i}@x.com` }).id);
    const r = await sendBlast({ job_id: 'job1', candidate_ids: ids }, { repo: s.repo, env: env({ OUTREACH_LIVE: true }), email: s.email });
    expect(r.sent).toBe(50);
  });

  describe('manual DM queue', () => {
    const li = { platform: 'linkedin' as const, url: 'https://www.linkedin.com/in/jane', handle: 'jane' };
    const xp = { platform: 'x' as const, url: 'https://x.com/jane', handle: 'jane' };

    it('queues a DM with a signed link, even when not live; nothing is sent', async () => {
      const s = setup();
      s.repo.addPerson({ id: 'li', dedupe_key: 'li', name: 'Jane Doe', headline: 'Contract attorney', profiles: [li] });
      const r = await sendBlastDetailed({ job_id: 'job1', candidate_ids: ['li', 'a'] }, { repo: s.repo, env: env(), email: s.email });
      expect(r.queued_manual).toBe(1);
      expect(r.dry_run).toBe(1);
      expect(r.sent).toBe(0);
      expect(r.outreach_ids).toHaveLength(2);
      const rows = await s.repo.listOutreachForJob('job1');
      const row = rows.find((o) => o.worker_id === 'li')!;
      expect(row).toMatchObject({ channel: 'linkedin_manual', status: 'queued' });
      const tasks = await s.repo.listManualTasks({ job_id: 'job1' });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ platform: 'linkedin', profile_url: li.url, status: 'queued', worker_id: 'li' });
      expect(tasks[0]!.message).toContain(`https://app.test/j/${row.token}`);
      expect(tasks[0]!.message.length).toBeLessThanOrEqual(500);
      expect(verifyJobToken(row.token, 'sek')?.worker_id).toBe('li');
      expect(s.repo.people.get('li')!.last_contacted_at).toBeNull();
      expect(s.email.sent).toHaveLength(0);
    });

    it('prefers email over DM, and linkedin over x', async () => {
      const s = setup();
      s.repo.addPerson({ id: 'both', dedupe_key: 'both', email: 'both@x.com', profiles: [li] });
      s.repo.addPerson({ id: 'two', dedupe_key: 'two', profiles: [xp, li] });
      const r = await sendBlastDetailed({ job_id: 'job1', candidate_ids: ['both', 'two'] }, { repo: s.repo, env: env({ OUTREACH_LIVE: true }), email: s.email });
      expect(r.sent).toBe(1);
      expect(r.queued_manual).toBe(1);
      expect((await s.repo.listManualTasks({}))[0]!.platform).toBe('linkedin');
    });

    it('enforces the daily cap per platform, counting earlier tasks in the last 24h', async () => {
      const s = setup();
      for (const id of ['m1', 'm2', 'm3']) s.repo.addPerson({ id, dedupe_key: id, profiles: [{ ...li, url: `https://www.linkedin.com/in/${id}` }] });
      s.repo.addPerson({ id: 'mx', dedupe_key: 'mx', profiles: [xp] });
      const r = await sendBlastDetailed({ job_id: 'job1', candidate_ids: ['m1', 'm2', 'm3', 'mx'] }, { repo: s.repo, env: env({ OUTREACH_MANUAL_DAILY_CAP: 2 }), email: s.email });
      expect(r.queued_manual).toBe(3); // 2 linkedin + 1 x
      const capped = r.results.filter((x) => x.reason === 'manual_daily_cap');
      expect(capped).toHaveLength(1);
      expect(capped[0]!.status).toBe('skipped_manual_cap');
      // capped person got no outreach row, so a later blast can still reach them
      expect((await s.repo.listOutreachForJob('job1')).some((o) => o.worker_id === capped[0]!.person_id)).toBe(false);
    });

    it('is idempotent: a second blast does not queue again', async () => {
      const s = setup();
      s.repo.addPerson({ id: 'li', dedupe_key: 'li', profiles: [li] });
      const d = { repo: s.repo, env: env(), email: s.email };
      await sendBlast({ job_id: 'job1', candidate_ids: ['li'] }, d);
      const again = await sendBlast({ job_id: 'job1', candidate_ids: ['li'] }, d);
      expect(again.queued_manual).toBe(0);
      expect(await s.repo.listManualTasks({})).toHaveLength(1);
    });

    it('pause switch queues nothing; opted-out people are never queued', async () => {
      const s = setup();
      s.repo.addPerson({ id: 'li', dedupe_key: 'li', profiles: [li] });
      s.repo.addPerson({ id: 'lo', dedupe_key: 'lo', profiles: [xp], opted_out: true });
      const paused = await sendBlast({ job_id: 'job1', candidate_ids: ['li'] }, { repo: s.repo, env: env({ PAUSE_OUTREACH: true }), email: s.email });
      expect(paused.queued_manual).toBe(0);
      const r = await sendBlast({ job_id: 'job1', candidate_ids: ['lo'] }, { repo: s.repo, env: env(), email: s.email });
      expect(r).toMatchObject({ queued_manual: 0, skipped_opted_out: 1 });
      expect(await s.repo.listManualTasks({})).toHaveLength(0);
    });
  });
});
