import { describe, expect, it } from 'vitest';
import { growthReport } from '../src/report.js';
import { NOW, prospect, recruitContact, setup } from './helpers.js';

describe('growth_report', () => {
  it('counts the directory per family, with targets from demand and the gaps', async () => {
    const s = setup();
    const a = await recruitContact(s, 'a@devs.example');
    const b = await recruitContact(s, 'b@devs.example');
    await recruitContact(s, 'c@devs.example');
    await s.repo.markContacted(a.id, NOW);
    await s.repo.markJoined(a.id, NOW);
    await s.repo.markJoined(b.id, NOW);
    s.repo.verifications.push({ worker_id: a.worker_id!, kind: 'identity', status: 'verified' }, { worker_id: b.worker_id!, kind: 'identity', status: 'pending' });
    for (let i = 0; i < 4; i++) {
      s.repo.jobs.push({ id: `j${i}`, title: 'Fix our Next.js deploy', instructions: 'remote', certification_required: null, lat: null, lng: null, remote: true, status: 'paid', worker_id: 'w', created_at: NOW, updated_at: NOW, customer_id: null, budget_usd: 60 });
    }
    await prospect(s.repo);
    const r = await growthReport(s.deps);
    expect(r.directory.developers).toEqual({ found: 3, invited: 1, opted_in: 2, id_verified: 1, licensed: 0, target: 24, gap: 23 });
    expect(r.directory.sf_notaries).toEqual({ found: 0, invited: 0, opted_in: 0, id_verified: 0, licensed: 0, target: 5, gap: 5 });
    expect(r.demand.by_family.developers).toEqual({ last_7d: 4, prior_7d: 0, projected_next_7d: 8, unfilled_7d: 0 });
    expect(r.sales).toEqual({ sent_today: 0, dry_run_today: 0, daily_cap: 25, prospects_waiting: 1 });
    expect(r.recruiting).toEqual({ sent_today: 0, dry_run_today: 0, daily_cap: 40, search_spend_today_usd: 0, search_cap_usd: 2 });
    expect(r.live).toEqual({ sales: false, recruit: false });
    expect(r.promos).toEqual({ granted: 0, max: 20, redeemed: 0, due: [] });
    expect(r.day).toBe('2026-11-08');
  });
});
