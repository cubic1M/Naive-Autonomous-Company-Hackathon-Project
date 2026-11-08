import { describe, expect, it } from 'vitest';
import { createGrowthTools } from '../src/tools.js';
import { setup } from './helpers.js';

describe('createGrowthTools', () => {
  it('validates the family and runs each call', async () => {
    const s = setup();
    const tools = createGrowthTools(s.deps);
    await expect(tools.recruit_search({ family: 'plumbers' })).rejects.toThrow(/unknown family/);
    await expect(tools.recruit_invite({ family: 'plumbers', person_ids: ['x'] })).rejects.toThrow(/unknown family/);
    expect((await tools.list_prospects({})).daily_cap).toBe(25);
    expect((await tools.growth_report()).day).toBe('2026-11-08');
    expect(await tools.redeem_promo({ job_id: 'nope' })).toEqual({ eligible: false, reason: 'job_not_found' });
  });
});
