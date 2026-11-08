import { describe, expect, it } from 'vitest';
import { decide } from '../src/guard.js';
import { listProspects, sendMarketing, suppressContact } from '../src/sales.js';
import { DAY_MS } from '../src/time.js';
import { NOW, TEAM, prospect, recruitContact, setup } from './helpers.js';

describe('list_prospects', () => {
  it('lists prospects not yet emailed, without their full address', async () => {
    const s = setup();
    const c = await prospect(s.repo);
    const r = await listProspects(s.deps);
    expect(r).toEqual({
      prospects: [{ contact_id: c.id, name: 'Jane Doe', org: 'AgentCo', email_domain: 'agentco.example', notes: 'Agent that books event venues', found_via: 'the YC x Naïve hackathon team list', free_first_job: true }],
      used_today: 0,
      daily_cap: 25,
    });
    expect(JSON.stringify(r)).not.toContain('jane@');
  });
});

describe('send_marketing', () => {
  it('dry-runs a prospect outside the allowlist: nothing sent, no grant, not marked contacted', async () => {
    const s = setup();
    const c = await prospect(s.repo);
    expect(await sendMarketing(s.deps, { contact_id: c.id, offer_free_first_job: true })).toEqual({ contact_id: c.id, status: 'dry_run', promo: { granted: false, reason: 'dry_run' } });
    expect(s.sales.sent).toHaveLength(0);
    expect(s.repo.grants).toHaveLength(0);
    expect((await s.repo.getContact(c.id))!.last_contacted_at).toBeNull();
    expect(s.repo.logs.map((l) => [l.kind, l.status])).toEqual([['marketing', 'dry_run']]);
  });

  it('sends to the allowlisted team address, marks it contacted and records the grant', async () => {
    const s = setup();
    const c = await prospect(s.repo, { email: TEAM, name: 'Team Tester' });
    const r = await sendMarketing(s.deps, { contact_id: c.id, personal_line: 'Your venue agent could send someone to check a room.', offer_free_first_job: true });
    expect(r).toEqual({ contact_id: c.id, status: 'sent', promo: { granted: true, cap_usd: 25, expires_at: new Date(NOW.getTime() + 14 * DAY_MS).toISOString() } });
    expect(s.sales.sent).toHaveLength(1);
    const m = s.sales.sent[0]!;
    expect(m.to).toBe(TEAM);
    expect(m.body).toContain('Hi Team,');
    expect(m.body).toContain('Your venue agent could send someone to check a room.');
    expect(m.body).toContain("Your team's first job is on us");
    expect(m.body).toMatch(/https:\/\/operis\.live\/v1\/growth\/unsubscribe\?t=u\./);
    expect((await s.repo.getContact(c.id))!.last_contacted_at).toEqual(NOW);
    expect(s.repo.grants.map((g) => g.grant_key)).toEqual(['operis.example']);
    expect(s.repo.logs.at(-1)).toMatchObject({ kind: 'marketing', status: 'sent', reason: 'allowlist' });
  });

  it('gives one grant per company domain and at most GROWTH_PROMO_MAX_GRANTS', async () => {
    const s = setup({ OUTREACH_TEST_ALLOWLIST: ['a@one.example', 'b@one.example', 'c@two.example'], GROWTH_PROMO_MAX_GRANTS: 1 });
    const send = async (email: string) => sendMarketing(s.deps, { contact_id: (await prospect(s.repo, { email })).id, offer_free_first_job: true });
    expect((await send('a@one.example')).promo).toMatchObject({ granted: true });
    expect(await send('b@one.example')).toMatchObject({ status: 'sent', promo: { granted: false, reason: 'already_granted' } });
    expect(await send('c@two.example')).toMatchObject({ status: 'sent', promo: { granted: false, reason: 'max_grants' } });
    expect(s.sales.sent.map((m) => m.body.includes('first job is on us'))).toEqual([true, false, false]);
  });

  it('never offers the free first job to a prospect not marked for it', async () => {
    const s = setup();
    const c = await prospect(s.repo, { email: TEAM, free_first_job: false });
    expect((await sendMarketing(s.deps, { contact_id: c.id, offer_free_first_job: true })).promo).toEqual({ granted: false, reason: 'not_eligible' });
    expect(s.sales.sent[0]!.body).not.toContain('first job is on us');
  });

  it('refuses ids that are not prospects and personal lines with links', async () => {
    const s = setup();
    const r = await recruitContact(s, 'ada@devs.example');
    expect(await sendMarketing(s.deps, { contact_id: r.id })).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/^not_a_prospect/) });
    expect(await sendMarketing(s.deps, { contact_id: 'nope' })).toMatchObject({ status: 'skipped' });
    const c = await prospect(s.repo, { email: TEAM });
    expect(await sendMarketing(s.deps, { contact_id: c.id, personal_line: 'see agentco.dev' })).toMatchObject({ status: 'skipped', reason: 'personal_line_has_link' });
    expect(s.sales.sent).toHaveLength(0);
  });

  it('fails cleanly, sending nothing, when no sender is configured', async () => {
    const s = setup();
    s.deps.senders = {};
    const c = await prospect(s.repo, { email: TEAM });
    expect(await sendMarketing(s.deps, { contact_id: c.id })).toMatchObject({ status: 'failed', reason: expect.stringMatching(/^no_sender/) });
    expect((await s.repo.getContact(c.id))!.last_contacted_at).toBeNull();
  });
});

describe('suppress_contact', () => {
  it('opts the address out of growth and of Ops outreach, even with no contact row yet', async () => {
    const s = setup();
    s.pool.addPerson({ email: 'x@agentco.example', dedupe_key: 'email:x@agentco.example' });
    expect(await suppressContact(s.deps, { email: 'X@AgentCo.example', reason: 'replied: please stop' })).toEqual({ suppressed: true, matched_contacts: 0, matched_workers: 1 });
    expect([...s.pool.people.values()][0]!.opted_out).toBe(true);
    expect(await decide(s.deps, 'marketing', 'x@agentco.example')).toEqual({ action: 'skip', reason: 'opted_out' });
    expect((await prospect(s.repo, { email: 'x@agentco.example' })).opted_out).toBe(true); // a later CSV import
  });

  it('rejects something that is not an email address', async () => {
    await expect(suppressContact(setup().deps, { email: 'not an email', reason: 'x' })).rejects.toThrow(/not an email/);
  });
});
