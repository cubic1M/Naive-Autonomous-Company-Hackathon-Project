// services/money-verification/test/liability-repo.test.ts
import { describe, expect, it } from 'vitest';
import { InMemoryRepo } from '../src/repo/memory.js';
import { JOB_ID, T0 } from './helpers.js';

const decision = (model: 'operis' | 'connector' | 'refuse') => ({
  model, rule_id: model === 'operis' ? 'D' : 'U', reason: 'test', policy_version: '2026-11-08', decided_by: 'test', decided_at: T0,
});

describe('job_liability in the repo', () => {
  it('inserts once and returns the first row on retry', async () => {
    const repo = new InMemoryRepo();
    const a = await repo.insertJobLiability({ job_id: JOB_ID, tags: { rules: ['L2'], forced: 'connector' }, pricing: 'connector' });
    const b = await repo.insertJobLiability({ job_id: JOB_ID, tags: { rules: [], forced: null }, pricing: 'standard' });
    expect(b).toEqual(a);
    expect(a.model).toBeNull();
  });
  it('records a decision only once', async () => {
    const repo = new InMemoryRepo();
    await repo.insertJobLiability({ job_id: JOB_ID, tags: { rules: [], forced: null }, pricing: 'standard' });
    const first = await repo.decideJobLiability(JOB_ID, decision('operis'));
    const second = await repo.decideJobLiability(JOB_ID, decision('connector'));
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.row.model).toBe('operis');
    expect((await repo.getJobLiability(JOB_ID))?.decided_at).toEqual(T0);
  });
  it('keeps the hints intake stored next to the tags', async () => {
    const repo = new InMemoryRepo();
    await repo.insertJobLiability({ job_id: JOB_ID, tags: { rules: [], forced: null, hints: ['L2'] }, pricing: 'standard' });
    expect((await repo.getJobLiability(JOB_ID))?.tags).toEqual({ rules: [], forced: null, hints: ['L2'] });
  });
  it('returns null for an unknown job', async () => {
    expect(await new InMemoryRepo().getJobLiability(JOB_ID)).toBeNull();
  });
});
