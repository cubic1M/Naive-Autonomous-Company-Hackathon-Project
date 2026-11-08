import { describe, expect, it } from 'vitest';
import { InMemoryRepo } from '../src/repo/memory.js';

const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';

describe('InMemoryRepo: customers', () => {
  it('getCustomerPayment is null for an unknown customer and returns the seeded row otherwise', async () => {
    const repo = new InMemoryRepo();
    expect(await repo.getCustomerPayment(CUSTOMER_ID)).toBeNull();
    repo.seedCustomer({ customer_id: CUSTOMER_ID, name: 'Acme Agent', email: 'ops@acme.test', stripe_customer_id: null, default_payment_method_id: null });
    expect(await repo.getCustomerPayment(CUSTOMER_ID)).toMatchObject({ customer_id: CUSTOMER_ID, stripe_customer_id: null });
  });

  it('setCustomerPayment merges only the given fields', async () => {
    const repo = new InMemoryRepo();
    repo.seedCustomer({ customer_id: CUSTOMER_ID, name: null, email: null, stripe_customer_id: 'cus_1', default_payment_method_id: null });
    await repo.setCustomerPayment(CUSTOMER_ID, { default_payment_method_id: 'pm_1' });
    expect(await repo.getCustomerPayment(CUSTOMER_ID)).toMatchObject({ stripe_customer_id: 'cus_1', default_payment_method_id: 'pm_1' });
    await expect(repo.setCustomerPayment('missing', { stripe_customer_id: 'cus_2' })).rejects.toThrow(/not found/);
  });
});
