import { afterEach, describe, expect, it, vi } from 'vitest';
import { depsFromApiContext, type ApiContext } from '../src/api-context.js';

/** A ToolContext whose database holds one customer with a card saved under the sandbox key (stripe_livemode null). */
const withSandboxCard = (): ApiContext => ({
  sql: {
    async unsafe() {
      return [{ id: 'c1', stripe_customer_id: 'cus_test', default_payment_method_id: 'pm_test', stripe_livemode: null }];
    },
  },
  baseUrl: 'https://operis.test',
  async transition(jobId, to) {
    return { id: jobId, status: to };
  },
  log: () => {},
});

describe('api-context: the repo and webhooks follow the mode of STRIPE_SECRET_KEY', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('a live key hides ids saved in test mode; a test key still sees them', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'rk_live_x');
    const live = depsFromApiContext(withSandboxCard());
    expect(live.stripeMode).toBe('live');
    expect(await live.repo.getCustomerPayment('c1')).toMatchObject({ stripe_customer_id: null, default_payment_method_id: null });
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
    expect(await depsFromApiContext(withSandboxCard()).repo.getCustomerPayment('c1')).toMatchObject({ stripe_customer_id: 'cus_test' });
  });

  it('a key that is neither sk_/rk_ live nor test is a config error, not a silent test-mode guess', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'pk_live_x');
    expect(() => depsFromApiContext(withSandboxCard())).toThrow(/STRIPE_SECRET_KEY must be/);
  });
});
