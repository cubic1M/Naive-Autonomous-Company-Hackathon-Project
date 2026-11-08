// services/money-verification/test/attorney.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCalBarProfile, verifyAttorney } from '../src/certs/attorney.js';
import { InMemoryRepo } from '../src/repo/memory.js';
import { T0, WORKER_ID } from './helpers.js';

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const page = (body: string, status = 200) => async () => ({ status, body });

describe('parseCalBarProfile', () => {
  it('reads the name and the licence status', () => {
    expect(parseCalBarProfile(fixture('calbar-active.html'))).toEqual({ name: 'Jordan Q. Example', status: 'Active' });
    expect(parseCalBarProfile(fixture('calbar-inactive.html')).status).toBe('Inactive');
    expect(parseCalBarProfile('<html>nothing here</html>')).toEqual({ name: null, status: null });
  });
});

describe('verifyAttorney', () => {
  const run = (fetchText: () => Promise<{ status: number; body: string }>, name = 'Jordan Example', barNumber = '999001') => {
    const repo = new InMemoryRepo();
    return { repo, out: verifyAttorney({ repo, fetchText, now: () => T0 }, { workerId: WORKER_ID, barNumber, name }) };
  };
  it('verifies an active licence with a matching name and stores it for thirty days', async () => {
    const { repo, out } = run(page(fixture('calbar-active.html')));
    expect(await out).toMatchObject({ status: 'verified', reasons: [], licence_status: 'Active' });
    const v = await repo.getWorkerVerification(WORKER_ID, 'attorney_license');
    expect(v).toMatchObject({ status: 'verified', provider_ref: '999001' });
    expect(v?.expires_at?.getTime()).toBe(T0.getTime() + 30 * 24 * 3600 * 1000);
  });
  it('fails an inactive licence', async () => {
    expect(await run(page(fixture('calbar-inactive.html'))).out).toMatchObject({ status: 'failed', reasons: ['licence_not_active: Inactive'] });
  });
  it('fails a name that does not match', async () => {
    expect(await run(page(fixture('calbar-active.html')), 'Someone Else').out).toMatchObject({ status: 'failed', reasons: ['name_mismatch'] });
  });
  it('fails an unknown number and an invalid one without fetching', async () => {
    expect(await run(page('', 404)).out).toMatchObject({ status: 'failed', reasons: ['not_found'] });
    let fetched = false;
    expect(await run(async () => { fetched = true; return { status: 200, body: '' }; }, 'Jordan Example', 'abc').out)
      .toMatchObject({ status: 'failed', reasons: ['invalid_bar_number'] });
    expect(fetched).toBe(false);
  });
  it('fails an unassigned number, which the State Bar answers with 200 and an empty profile', async () => {
    const empty = '<html><head><title>\n # 999002 - Attorney Licensee Search\n  </title></head><body><h3 class="donotprint"><b>Attorney Profile</b></h3></body></html>';
    expect(await run(page(empty), 'Jordan Example', '999002').out).toMatchObject({ status: 'failed', reasons: ['not_found'] });
  });
  it('needs review when the lookup is unreachable, and stores nothing verified', async () => {
    const { repo, out } = run(async () => { throw new Error('ECONNRESET'); });
    expect(await out).toMatchObject({ status: 'needs_review', reasons: ['lookup_unavailable'] });
    expect((await repo.getWorkerVerification(WORKER_ID, 'attorney_license'))?.status).not.toBe('verified');
  });
});
