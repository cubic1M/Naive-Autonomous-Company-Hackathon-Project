import { describe, expect, it } from 'vitest';
import { growthEnvFromProcess } from '../src/env.js';

const base = { PUBLIC_BASE_URL: 'https://operis.live/', LINK_SIGNING_SECRET: 's' };

describe('growthEnvFromProcess', () => {
  it('reads the defaults, the allowlist and the invite sender fallback', () => {
    const e = growthEnvFromProcess({ ...base, OUTREACH_TEST_ALLOWLIST: ' Team@Operis.example ,x@y.example', AGENTMAIL_INBOX: 'ops@mail.operis.live' });
    expect(e.PUBLIC_BASE_URL).toBe('https://operis.live');
    expect(e.GROWTH_LIVE).toEqual([]);
    expect(e.GROWTH_PAUSE).toBe(false);
    expect(e.GROWTH_POSTAL_ADDRESS).toBeNull();
    expect(e.OUTREACH_TEST_ALLOWLIST).toEqual(['team@operis.example', 'x@y.example']);
    expect([e.GROWTH_SALES_DAILY_CAP, e.GROWTH_RECRUIT_DAILY_CAP, e.GROWTH_SEARCH_DAILY_USD]).toEqual([25, 40, 2]);
    expect([e.GROWTH_PROMO_MAX_GRANTS, e.GROWTH_PROMO_CAP_USD, e.GROWTH_PROMO_DAYS]).toEqual([20, 25, 14]);
    expect(e.GROWTH_RECRUIT_AGENTMAIL_INBOX).toBe('ops@mail.operis.live');
  });

  it('PAUSE_OUTREACH pauses growth too; GROWTH_LIVE takes only sales and recruit', () => {
    expect(growthEnvFromProcess({ ...base, PAUSE_OUTREACH: 'true' }).GROWTH_PAUSE).toBe(true);
    expect(growthEnvFromProcess({ ...base, GROWTH_LIVE: 'sales, Recruit' }).GROWTH_LIVE).toEqual(['sales', 'recruit']);
    expect(() => growthEnvFromProcess({ ...base, GROWTH_LIVE: 'everyone' })).toThrow(/unknown kind/);
  });

  it('requires the link base and secret, and rejects bad numbers', () => {
    expect(() => growthEnvFromProcess({ LINK_SIGNING_SECRET: 's' })).toThrow(/PUBLIC_BASE_URL/);
    expect(() => growthEnvFromProcess({ PUBLIC_BASE_URL: 'https://operis.live' })).toThrow(/LINK_SIGNING_SECRET/);
    expect(() => growthEnvFromProcess({ ...base, GROWTH_SALES_DAILY_CAP: '-1' })).toThrow(/GROWTH_SALES_DAILY_CAP/);
  });
});
