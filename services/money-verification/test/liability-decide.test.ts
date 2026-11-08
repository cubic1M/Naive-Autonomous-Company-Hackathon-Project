// services/money-verification/test/liability-decide.test.ts
import { describe, expect, it } from 'vitest';
import { InMemoryRepo } from '../src/repo/memory.js';
import { allowedModels, decideByTags, decideFallback, getLiabilityContext, setLiability } from '../src/liability/decide.js';
import { createTools } from '../src/tools.js';
import { JOB_ID, T0, makeJob, makeWorld } from './helpers.js';

/** A funded job: decisions are recorded only while a job is held. */
const heldRepo = () => { const repo = new InMemoryRepo(); repo.seedJob(makeJob({ status: 'held', worker_id: null })); return repo; };
const deps = (repo = heldRepo()) => ({ repo, now: () => T0 });
const seed = async (repo: InMemoryRepo, rules: string[], forced: 'connector' | 'refuse' | null, pricing: 'standard' | 'connector') =>
  repo.insertJobLiability({ job_id: JOB_ID, tags: { rules, forced }, pricing });
const set = (d: ReturnType<typeof deps>, model: 'operis' | 'connector' | 'refuse', ruleId: string, reason = 'per policy') =>
  setLiability(d, { jobId: JOB_ID, model, ruleId, reason, decidedBy: 'compliance-agent' });

describe('allowedModels', () => {
  it('follows the forced tag', () => {
    expect(allowedModels({ rules: ['L3'], forced: 'refuse' })).toEqual(['refuse']);
    expect(allowedModels({ rules: ['L2'], forced: 'connector' })).toEqual(['connector', 'refuse']);
    expect(allowedModels({ rules: [], forced: null })).toEqual(['operis', 'connector', 'refuse']);
  });
});

describe('setLiability', () => {
  it('records operis under D and asks to wake the CEO', async () => {
    const d = deps(); await seed(d.repo, [], null, 'standard');
    const out = await set(d, 'operis', 'D');
    expect(out).toMatchObject({ next: 'wake_ceo', changed: true, liability: { model: 'operis', rule_id: 'D', policy_version: '2026-11-08', decided_by: 'compliance-agent', decided_at: T0 } });
  });
  it('records connector under L2 on a connector-priced job', async () => {
    const d = deps(); await seed(d.repo, ['L2'], 'connector', 'connector');
    expect((await set(d, 'connector', 'L2')).liability.model).toBe('connector');
  });
  it('asks to cancel on refuse', async () => {
    const d = deps(); await seed(d.repo, [], null, 'standard');
    expect((await set(d, 'refuse', 'R', 'surveillance of a person')).next).toBe('cancel');
  });
  it('rejects an unknown rule', async () => {
    const d = deps(); await seed(d.repo, [], null, 'standard');
    await expect(set(d, 'operis', 'Z9')).rejects.toThrow(/^unknown_rule/);
  });
  it('never lets the agent overrule a forced tag', async () => {
    const d = deps(); await seed(d.repo, ['L2'], 'connector', 'connector');
    await expect(set(d, 'operis', 'D')).rejects.toThrow(/^model_not_allowed/);
  });
  it('rejects a model that does not match the rule', async () => {
    const d = deps(); await seed(d.repo, [], null, 'standard');
    await expect(set(d, 'operis', 'U')).rejects.toThrow(/^rule_mismatch/);
  });
  it('requires a re-post when L1/L2 work arrives priced as standard', async () => {
    const d = deps(); await seed(d.repo, [], null, 'standard');
    await expect(set(d, 'connector', 'L2')).rejects.toThrow(/^repost_required/);
    expect((await set(d, 'refuse', 'L2', 'legal work priced as standard; re-post as a legal job')).next).toBe('cancel');
  });
  it('refuses a licensed rule intake did not tag (no L1/L2 swap)', async () => {
    const d = deps(); await seed(d.repo, ['L2'], 'connector', 'connector');
    await expect(set(d, 'connector', 'L1')).rejects.toThrow(/^rule_not_tagged/);
    expect((await set(d, 'connector', 'L2')).liability.rule_id).toBe('L2');
  });
  it('records nothing for a job that is not held', async () => {
    for (const status of ['requested', 'outreach', 'accepted', 'cancelled'] as const) {
      const repo = new InMemoryRepo(); repo.seedJob(makeJob({ status, worker_id: null }));
      await expect(set(deps(repo), 'operis', 'D')).rejects.toThrow(/^job_not_held: .* is /);
      expect((await repo.getJobLiability(JOB_ID))?.model ?? null).toBeNull();
    }
    await expect(set(deps(new InMemoryRepo()), 'operis', 'D')).rejects.toThrow(/not found/);
  });
  it('creates the intake row for a job created before this shipped', async () => {
    const d = deps();
    expect((await set(d, 'operis', 'D')).liability.pricing).toBe('standard');
  });
  it('is idempotent for the same decision and refuses a different one', async () => {
    const d = deps(); await seed(d.repo, [], null, 'standard');
    await set(d, 'operis', 'D');
    expect((await set(d, 'operis', 'D')).changed).toBe(false);
    await expect(set(d, 'connector', 'U')).rejects.toThrow(/^already_decided/);
  });
});

describe('decideFallback', () => {
  it.each([
    [['L3'], 'refuse', 'standard', 'refuse', 'L3', 'cancel'],
    [['L1'], 'connector', 'connector', 'connector', 'L1', 'wake_ceo'],
    [[], null, 'standard', 'connector', 'U', 'wake_ceo'],
  ] as const)('tags %j -> %s', async (rules, forced, pricing, model, rule, next) => {
    const d = deps(); await seed(d.repo, [...rules], forced, pricing);
    const out = await decideFallback(d, JOB_ID);
    expect(out).toMatchObject({ next, changed: true, liability: { model, rule_id: rule, decided_by: 'fallback', reason: 'no decision within fifteen minutes' } });
  });
  it('leaves an existing decision alone', async () => {
    const d = deps(); await seed(d.repo, [], null, 'standard');
    await set(d, 'operis', 'D');
    expect((await decideFallback(d, JOB_ID)).changed).toBe(false);
  });
});

describe('decideByTags (no Compliance agent configured)', () => {
  it.each([
    [['L3'], 'refuse', 'standard', 'refuse', 'L3', 'cancel'],
    [['L2'], 'connector', 'connector', 'connector', 'L2', 'wake_ceo'],
    [[], null, 'standard', 'operis', 'D', 'wake_ceo'],
  ] as const)('tags %j -> %s', async (rules, forced, pricing, model, rule, next) => {
    const d = deps(); await seed(d.repo, [...rules], forced, pricing);
    expect(await decideByTags(d, JOB_ID)).toMatchObject({
      next, changed: true, liability: { model, rule_id: rule, decided_by: 'auto (no compliance agent)', reason: 'no Compliance agent configured: decided by the intake tags' },
    });
  });
  it('leaves an existing decision alone', async () => {
    const d = deps(); await seed(d.repo, [], null, 'standard');
    await set(d, 'connector', 'U');
    expect(await decideByTags(d, JOB_ID)).toMatchObject({ changed: false, liability: { model: 'connector', rule_id: 'U' } });
  });
});

describe('getLiabilityContext', () => {
  it('returns tags, pricing, allowed models and the full policy text', async () => {
    const d = deps(); await seed(d.repo, ['L2'], 'connector', 'connector');
    const ctx = await getLiabilityContext(d, JOB_ID);
    expect(ctx).toMatchObject({ job_id: JOB_ID, pricing: 'connector', allowed_models: ['connector', 'refuse'], decision: null, policy_version: '2026-11-08' });
    expect(ctx.policy).toContain('L2 Legal services');
  });
  it('passes the hints to the agent, and an empty list when intake stored none', async () => {
    const d = deps();
    await d.repo.insertJobLiability({ job_id: JOB_ID, tags: { rules: [], forced: null, hints: ['L1'] }, pricing: 'standard' });
    expect((await getLiabilityContext(d, JOB_ID)).tags).toEqual({ rules: [], forced: null, hints: ['L1'] });
    const other = deps(); await seed(other.repo, ['L2'], 'connector', 'connector');
    expect((await getLiabilityContext(other, JOB_ID)).tags.hints).toEqual([]);
  });
});

describe('liability tools', () => {
  it('set_liability trims the reason and reports what happens next', async () => {
    const world = makeWorld();
    world.repo.seedJob(makeJob({ status: 'held', worker_id: null }));
    const tools = createTools(world.deps);
    const out = await tools.set_liability({ job_id: JOB_ID, model: 'operis', rule_id: 'D', reason: '  photo job, no licence  ' });
    expect(out).toEqual({ job_id: JOB_ID, model: 'operis', rule_id: 'D', reason: 'photo job, no licence', next: 'wake_ceo', changed: true });
  });
  it('set_liability rejects an empty reason', async () => {
    const tools = createTools(makeWorld().deps);
    await expect(tools.set_liability({ job_id: JOB_ID, model: 'operis', rule_id: 'D', reason: '' })).rejects.toThrow();
  });
});
