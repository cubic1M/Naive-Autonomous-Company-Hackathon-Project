import { describe, expect, it } from 'vitest';
import { decide } from '../src/guard.js';
import { DAY_MS } from '../src/time.js';
import { NOW, TEAM, prospect, setup } from './helpers.js';

const STRANGER = 'founder@agentco.example';
const ADDRESS = '1 Example St, San Francisco, CA 94100';

describe('decide', () => {
  it('dry-runs a stranger while not live and sends to the team allowlist as a test', async () => {
    const { deps } = setup();
    expect(await decide(deps, 'marketing', STRANGER)).toEqual({ action: 'dry_run' });
    expect(await decide(deps, 'invite', 'Team@Operis.example')).toEqual({ action: 'send', mode: 'test' });
  });

  it('sends to anyone only when that kind is live and a postal address is set', async () => {
    const live = { GROWTH_LIVE: ['sales' as const], GROWTH_POSTAL_ADDRESS: ADDRESS };
    expect(await decide(setup(live).deps, 'marketing', STRANGER)).toEqual({ action: 'send', mode: 'live' });
    expect(await decide(setup(live).deps, 'invite', STRANGER)).toEqual({ action: 'dry_run' });
    expect(await decide(setup({ GROWTH_LIVE: ['sales', 'recruit'] }).deps, 'marketing', STRANGER)).toEqual({ action: 'dry_run' });
  });

  it('skips everyone when paused, the allowlist included', async () => {
    expect(await decide(setup({ GROWTH_PAUSE: true }).deps, 'marketing', TEAM)).toEqual({ action: 'skip', reason: 'paused' });
  });

  it('skips an address opted out in growth or in the worker pool', async () => {
    const s = setup();
    await s.repo.optOutEmail(STRANGER, NOW);
    s.pool.addPerson({ email: 'gone@example.org', opted_out: true, dedupe_key: 'email:gone@example.org' });
    expect(await decide(s.deps, 'marketing', STRANGER)).toEqual({ action: 'skip', reason: 'opted_out' });
    expect(await decide(s.deps, 'invite', 'gone@example.org')).toEqual({ action: 'skip', reason: 'opted_out' });
  });

  it('skips an address sent to in the last 30 days, except the team allowlist', async () => {
    const s = setup();
    const c = await prospect(s.repo, { email: STRANGER });
    const team = await prospect(s.repo, { email: TEAM });
    await s.repo.markContacted(c.id, new Date(NOW.getTime() - 10 * DAY_MS));
    await s.repo.markContacted(team.id, new Date(NOW.getTime() - DAY_MS));
    expect(await decide(s.deps, 'marketing', STRANGER)).toEqual({ action: 'skip', reason: 'recently_contacted' });
    expect(await decide(s.deps, 'invite', STRANGER)).toEqual({ action: 'dry_run' });
    expect(await decide(s.deps, 'marketing', TEAM)).toEqual({ action: 'send', mode: 'test' });
    s.advance(21 * DAY_MS);
    expect(await decide(s.deps, 'marketing', STRANGER)).toEqual({ action: 'dry_run' });
  });

  it('skips once sends plus dry runs reach the daily cap, per kind, until the next Pacific day', async () => {
    const s = setup({ GROWTH_SALES_DAILY_CAP: 2 });
    await s.repo.log({ kind: 'marketing', status: 'sent' });
    await s.repo.log({ kind: 'marketing', status: 'dry_run' });
    await s.repo.log({ kind: 'marketing', status: 'skipped' });
    expect(await decide(s.deps, 'marketing', STRANGER)).toEqual({ action: 'skip', reason: 'daily_cap' });
    expect(await decide(s.deps, 'invite', STRANGER)).toEqual({ action: 'dry_run' });
    s.advance(DAY_MS);
    expect(await decide(s.deps, 'marketing', STRANGER)).toEqual({ action: 'dry_run' });
  });
});
