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
  describe('with a verified Stripe Identity on file, the ID name is compared, not the typed one', () => {
    const withIdentity = async (first: string | null, last: string | null, typed: string) => {
      const repo = new InMemoryRepo();
      await repo.upsertWorkerVerification({
        worker_id: WORKER_ID, kind: 'identity', status: 'verified', provider_ref: 'vs_test', details: { first_name: first, last_name: last },
        verified_at: T0, expires_at: null,
      });
      return verifyAttorney({ repo, fetchText: page(fixture('calbar-active.html')), now: () => T0 }, { workerId: WORKER_ID, barNumber: '999001', name: typed });
    };
    it('verifies when the ID name matches the State Bar profile', async () => {
      expect(await withIdentity('Jordan', 'Example', 'Jordan Example')).toMatchObject({ status: 'verified', reasons: [], name_source: 'verified_identity' });
    });
    it('fails a worker whose ID is someone else, even when the typed name matches the profile', async () => {
      const r = await withIdentity('Someone', 'Else', 'Jordan Q. Example');
      expect(r.status).toBe('failed');
      expect(r.reasons[0]).toBe('name_mismatch');
      expect(r.reasons.some((x) => x.startsWith('typed_name_mismatch'))).toBe(true);
    });
    it('flags a typed name that differs from the ID without changing the outcome', async () => {
      const r = await withIdentity('Jordan', 'Example', 'Pat Example');
      expect(r.status).toBe('verified');
      expect(r.reasons.some((x) => x.startsWith('typed_name_mismatch'))).toBe(true);
    });
    it('falls back to the typed name, and says so, when Stripe gave no name for the ID', async () => {
      const r = await withIdentity(null, null, 'Jordan Example');
      expect(r).toMatchObject({ status: 'verified', name_source: 'typed' });
      expect(r.reasons.some((x) => x.startsWith('id_name_unavailable'))).toBe(true);
    });
  });
  it('needs review when the lookup is unreachable, and stores nothing verified', async () => {
    const { repo, out } = run(async () => { throw new Error('ECONNRESET'); });
    expect(await out).toMatchObject({ status: 'needs_review', reasons: ['lookup_unavailable'] });
    expect((await repo.getWorkerVerification(WORKER_ID, 'attorney_license'))?.status).not.toBe('verified');
  });
});
