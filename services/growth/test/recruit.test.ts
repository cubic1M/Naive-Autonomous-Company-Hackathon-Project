import { describe, expect, it } from 'vitest';
import { personEnrichers } from '../../outreach/src/enrich/index.js';
import { LINKEDIN_WORK_EMAIL_ID } from '../../outreach/src/enrich/linkedinWorkEmail.js';
import { describeFound, recruitEnrichers, recruitInvite, recruitSearch } from '../src/recruit.js';
import { TEAM, fakeSource, lead, offlineMonid, recruitContact, setup } from './helpers.js';

const LEADS = [
  lead({}),
  lead({ name: 'No Email', email: null, source_ref: 'noemail', profile_url: 'https://github.com/noemail', profiles: [{ platform: 'github', url: 'https://github.com/noemail' }] }),
  lead({ name: 'Acme Dev Shop', kind: 'business', email: 'hello@acmedev.example', source_ref: 'acme', profile_url: null, profiles: [], website: 'https://acmedev.example' }),
];

function searching() {
  const s = setup();
  s.deps.monid = offlineMonid;
  s.deps.search = { sources: [fakeSource(LEADS)], enrichers: [] };
  return s;
}

describe('recruit_search', () => {
  it('saves individuals with a public email to the pool and returns them as candidates', async () => {
    const s = searching();
    const r = await recruitSearch(s.deps, { family: 'developers' });
    expect(r.candidates.map((c) => c.name)).toEqual(['Ada Lovelace']);
    expect(r).toMatchObject({ family: 'developers', new: 1, spend_usd: 0.01, spend_today_usd: 0.01, daily_cap_usd: 2 });
    expect([...s.pool.people.values()].map((p) => p.email)).toEqual(['ada@devs.example']);
    expect(s.repo.contacts).toMatchObject([
      { kind: 'recruit', email: 'ada@devs.example', family: 'developers', found_via: 'your public GitHub profile, where you list "Freelance Next.js and React developer"' },
    ]);
    expect(s.repo.logs).toMatchObject([{ kind: 'search', status: 'ok', family: 'developers', cost_usd: 0.01 }]);
  });

  it('finds the same person again without a second contact or pool row', async () => {
    const s = searching();
    await recruitSearch(s.deps, { family: 'developers' });
    expect((await recruitSearch(s.deps, { family: 'developers' })).new).toBe(0);
    expect(s.repo.contacts).toHaveLength(1);
    expect(s.pool.people.size).toBe(1);
  });

  it('leaves out anyone invited in the last 30 days or opted out', async () => {
    const s = searching();
    await recruitSearch(s.deps, { family: 'developers' });
    await s.repo.markContacted(s.repo.contacts[0]!.id, s.now());
    expect((await recruitSearch(s.deps, { family: 'developers' })).candidates).toEqual([]);
    const t = searching();
    await t.repo.optOutEmail('ada@devs.example', t.now());
    expect((await recruitSearch(t.deps, { family: 'developers' })).candidates).toEqual([]);
  });

  it('never uses the paid ContactOut work-email lookup', () => {
    expect(recruitEnrichers().map((e) => e.id)).not.toContain(LINKEDIN_WORK_EMAIL_ID);
    expect(recruitEnrichers()).toHaveLength(personEnrichers.length - 1);
  });

  it('stops at the daily search budget without calling anything', async () => {
    const s = setup();
    await s.repo.log({ kind: 'search', status: 'ok', cost_usd: 2 });
    expect(await recruitSearch(s.deps, { family: 'sf_notaries' })).toMatchObject({ found: 0, error: 'daily_search_budget_used', spend_today_usd: 2 });
  });

  it('needs a Monid key to search', async () => {
    await expect(recruitSearch(setup().deps, { family: 'developers' })).rejects.toThrow(/MONID_API_KEY/);
  });

  it('says where we found someone', () => {
    expect(describeFound({ profiles: [], headline: null })).toBe('your public profile online');
    expect(describeFound({ profiles: [{ platform: 'linkedin', url: 'x' }], headline: 'Mobile notary' })).toBe('your public LinkedIn profile, where you list "Mobile notary"');
  });
});

describe('recruit_invite', () => {
  it('sends a test invite to the allowlist, dry-runs a stranger and skips unknown ids', async () => {
    const s = setup();
    const team = await recruitContact(s, TEAM);
    const stranger = await recruitContact(s, 'ada@devs.example');
    const r = await recruitInvite(s.deps, { family: 'developers', person_ids: [team.worker_id!, stranger.worker_id!, '00000000-0000-4000-8000-000000000000'] });
    expect(r).toMatchObject({ sent: 1, dry_run: 1, skipped: 1, failed: 0, used_today: 2, daily_cap: 40 });
    expect(s.recruit.sent.map((m) => m.to)).toEqual([TEAM]);
    const m = s.recruit.sent[0]!;
    expect(m.subject).toBe('Join Operis: short paid coding jobs for AI teams (remote)');
    expect(m.body).toMatch(/https:\/\/operis\.live\/v1\/growth\/join\?t=j\./);
    expect(m.body).toContain('How we found you: your public GitHub profile.');
    expect(s.repo.logs.filter((l) => l.kind === 'invite').map((l) => l.status)).toEqual(['sent', 'dry_run']);
  });
});
