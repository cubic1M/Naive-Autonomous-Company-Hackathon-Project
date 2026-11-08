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
    expect(e.GROWTH_REDDIT_DAILY_USD).toBe(0.25);
    expect(growthEnvFromProcess({ ...base, GROWTH_REDDIT_DAILY_USD: '0' }).GROWTH_REDDIT_DAILY_USD).toBe(0);
    expect([e.GROWTH_PROMO_MAX_GRANTS, e.GROWTH_PROMO_CAP_USD, e.GROWTH_PROMO_DAYS]).toEqual([20, 25, 14]);
    expect(e.GROWTH_RECRUIT_AGENTMAIL_INBOX).toBe('ops@mail.operis.live');
  });

  it('PAUSE_OUTREACH pauses growth too; GROWTH_LIVE takes only sales and recruit', () => {
    expect(growthEnvFromProcess({ ...base, PAUSE_OUTREACH: 'true' }).GROWTH_PAUSE).toBe(true);
    expect(growthEnvFromProcess({ ...base, GROWTH_LIVE: 'sales, Recruit' }).GROWTH_LIVE).toEqual(['sales', 'recruit']);
    expect(() => growthEnvFromProcess({ ...base, GROWTH_LIVE: 'everyone' })).toThrow(/unknown kind/);
  });

  it('social posting: dry runs by default; the live list, the pause, a daily cap that never exceeds 10, Zernio', () => {
    const e = growthEnvFromProcess(base);
    expect(e.GROWTH_SOCIAL_LIVE).toEqual([]);
    expect(e.GROWTH_SOCIAL_PAUSE).toBe(false);
    expect(e.GROWTH_SOCIAL_DAILY_CAP).toBe(3);
    expect([e.ZERNIO_API_KEY, e.ZERNIO_X_ACCOUNT_ID, e.ZERNIO_THREADS_ACCOUNT_ID, e.ZERNIO_BLUESKY_ACCOUNT_ID]).toEqual([null, null, null, null]);
    const live = growthEnvFromProcess({
      ...base,
      GROWTH_SOCIAL_LIVE: 'X, threads',
      GROWTH_SOCIAL_PAUSE: 'true',
      GROWTH_SOCIAL_DAILY_CAP: '50',
      ZERNIO_API_KEY: ' sk_test ',
      ZERNIO_X_ACCOUNT_ID: 'acc_x',
      ZERNIO_BLUESKY_ACCOUNT_ID: 'acc_b',
    });
    expect(live.GROWTH_SOCIAL_LIVE).toEqual(['x', 'threads']);
    expect(live.GROWTH_SOCIAL_PAUSE).toBe(true);
    expect(live.GROWTH_SOCIAL_DAILY_CAP).toBe(10);
    expect([live.ZERNIO_API_KEY, live.ZERNIO_X_ACCOUNT_ID, live.ZERNIO_THREADS_ACCOUNT_ID, live.ZERNIO_BLUESKY_ACCOUNT_ID]).toEqual(['sk_test', 'acc_x', null, 'acc_b']);
    expect(() => growthEnvFromProcess({ ...base, GROWTH_SOCIAL_LIVE: 'linkedin' })).toThrow(/GROWTH_SOCIAL_LIVE: unknown platform "linkedin"/);
    expect(() => growthEnvFromProcess({ ...base, GROWTH_SOCIAL_DAILY_CAP: 'lots' })).toThrow(/GROWTH_SOCIAL_DAILY_CAP/);
  });

  it('requires the link base and secret, and rejects bad numbers', () => {
    expect(() => growthEnvFromProcess({ LINK_SIGNING_SECRET: 's' })).toThrow(/PUBLIC_BASE_URL/);
    expect(() => growthEnvFromProcess({ PUBLIC_BASE_URL: 'https://operis.live' })).toThrow(/LINK_SIGNING_SECRET/);
    expect(() => growthEnvFromProcess({ ...base, GROWTH_SALES_DAILY_CAP: '-1' })).toThrow(/GROWTH_SALES_DAILY_CAP/);
    expect(() => growthEnvFromProcess({ ...base, GROWTH_REDDIT_DAILY_USD: 'lots' })).toThrow(/GROWTH_REDDIT_DAILY_USD/);
  });
});
