// services/money-verification/test/eligibility.test.ts
// Licences the per-job liability tags require before accept (docs/specs/2026-11-08-liability-model-design.md).
// The tier and identity gate are covered in proof-tiers.test.ts and tools.test.ts.
import { describe, expect, it } from 'vitest';
import { checkEligibility } from '../src/eligibility.js';
import { InMemoryRepo } from '../src/repo/memory.js';
import { HOUR_MS, JOB_ID, T0, WORKER_ID, makeJob, makeWorker } from './helpers.js';

describe('licences required by the liability tags', () => {
  const setup = async (rules: string[]) => {
    const repo = new InMemoryRepo();
    repo.seedJob(makeJob({ status: 'outreach', worker_id: null }));
    repo.seedWorker(makeWorker());
    await repo.insertJobLiability({ job_id: JOB_ID, tags: { rules, forced: 'connector' }, pricing: 'connector' });
    return repo;
  };
  const attorneyCheck = (expires_at: Date) => ({
    worker_id: WORKER_ID, kind: 'attorney_license' as const, status: 'verified' as const, provider_ref: '999001', details: {}, verified_at: T0, expires_at,
  });

  it('refuses an L2 job without a verified attorney licence', async () => {
    const repo = await setup(['L2']);
    const r = await checkEligibility({ repo }, { workerId: WORKER_ID, jobId: JOB_ID });
    expect(r.eligible).toBe(false);
    expect(r.reasons.some((x) => x.startsWith('attorney_not_verified'))).toBe(true);
  });
  it('accepts an L2 job with a verified attorney licence that outlasts the deadline', async () => {
    const repo = await setup(['L2']);
    await repo.upsertWorkerVerification(attorneyCheck(new Date(T0.getTime() + 30 * 24 * 3600 * 1000)));
    const r = await checkEligibility({ repo }, { workerId: WORKER_ID, jobId: JOB_ID });
    expect(r.reasons.filter((x) => x.startsWith('attorney'))).toEqual([]);
  });
  it('refuses an L2 job when the State Bar check expires before the deadline', async () => {
    const repo = await setup(['L2']);
    await repo.upsertWorkerVerification(attorneyCheck(new Date(T0.getTime() + HOUR_MS))); // the deadline is T0 + 4h
    expect((await checkEligibility({ repo }, { workerId: WORKER_ID, jobId: JOB_ID })).reasons).toContain('attorney_check_expires_before_deadline');
  });
  it('requires a notary commission for an L1 tag even when task_type is not notarization', async () => {
    const repo = await setup(['L1']);
    const r = await checkEligibility({ repo }, { workerId: WORKER_ID, jobId: JOB_ID });
    expect(r.reasons.some((x) => x.startsWith('notary_not_verified'))).toBe(true);
  });
  it('requires a verified identity for licensed work even when IDENTITY_GATE is log', async () => {
    for (const rule of ['L1', 'L2']) {
      const repo = await setup([rule]);
      await repo.upsertWorkerVerification({ ...attorneyCheck(new Date(T0.getTime() + 30 * 24 * 3600 * 1000)), kind: rule === 'L1' ? 'notary_commission' : 'attorney_license' });
      const r = await checkEligibility({ repo, env: { IDENTITY_GATE: 'log' } }, { workerId: WORKER_ID, jobId: JOB_ID });
      expect(r.eligible).toBe(false);
      expect(r.reasons).toHaveLength(1);
      expect(r.reasons[0]).toMatch(/^identity_not_verified: notary and legal jobs need a verified identity/);
      await repo.upsertWorkerVerification({ worker_id: WORKER_ID, kind: 'identity', status: 'verified', provider_ref: 'vs_test', details: { first_name: 'Pat', last_name: 'Example' }, verified_at: T0, expires_at: null });
      expect(await checkEligibility({ repo, env: { IDENTITY_GATE: 'log' } }, { workerId: WORKER_ID, jobId: JOB_ID })).toMatchObject({ eligible: true, reasons: [] });
    }
  });
  it('under IDENTITY_GATE=log a notarization task and a rule Compliance recorded still need a verified identity', async () => {
    const later = new Date(T0.getTime() + 30 * 24 * 3600 * 1000);
    const notarization = new InMemoryRepo();
    notarization.seedJob(makeJob({ status: 'outreach', worker_id: null, task_type: 'notarization' })); // no liability row, no L1 tag
    notarization.seedWorker(makeWorker());
    await notarization.upsertWorkerVerification({ ...attorneyCheck(later), kind: 'notary_commission' });
    const byTask = await checkEligibility({ repo: notarization, env: { IDENTITY_GATE: 'log' } }, { workerId: WORKER_ID, jobId: JOB_ID });
    expect(byTask.eligible).toBe(false);
    expect(byTask.reasons).toEqual([expect.stringMatching(/^identity_not_verified: notary and legal jobs need a verified identity/)]);

    const recorded = await setup([]); // untagged at intake; Compliance recorded L2
    await recorded.decideJobLiability(JOB_ID, { model: 'connector', rule_id: 'L2', reason: 'recorded after intake', policy_version: '2026-11-08', decided_by: 'test', decided_at: T0 });
    await recorded.upsertWorkerVerification(attorneyCheck(later));
    const byRule = await checkEligibility({ repo: recorded, env: { IDENTITY_GATE: 'log' } }, { workerId: WORKER_ID, jobId: JOB_ID });
    expect(byRule.eligible).toBe(false);
    expect(byRule.reasons).toEqual([expect.stringMatching(/^identity_not_verified: notary and legal jobs need a verified identity/)]);
  });
  it('also requires the licence of the rule Compliance recorded', async () => {
    const repo = await setup(['L2']);
    await repo.decideJobLiability(JOB_ID, { model: 'connector', rule_id: 'L1', reason: 'recorded before the tag check', policy_version: '2026-11-08', decided_by: 'test', decided_at: T0 });
    const r = await checkEligibility({ repo }, { workerId: WORKER_ID, jobId: JOB_ID });
    expect(r.reasons.some((x) => x.startsWith('notary_not_verified'))).toBe(true);
    expect(r.reasons.some((x) => x.startsWith('attorney_not_verified'))).toBe(true);
  });
  it('changes nothing for a job without tags: a worker with a verified identity stays eligible', async () => {
    const repo = new InMemoryRepo();
    repo.seedJob(makeJob({ status: 'outreach', worker_id: null }));
    repo.seedWorker(makeWorker());
    await repo.upsertWorkerVerification({ worker_id: WORKER_ID, kind: 'identity', status: 'verified', provider_ref: 'vs_test', details: {}, verified_at: T0, expires_at: null });
    expect(await checkEligibility({ repo }, { workerId: WORKER_ID, jobId: JOB_ID })).toEqual({ eligible: true, reasons: [], tier: 1 });
  });
});
