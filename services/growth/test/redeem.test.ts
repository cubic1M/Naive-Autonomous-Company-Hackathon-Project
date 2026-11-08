import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { grantKeyFor } from '../src/promo.js';
import { PROMO_REASON, promosDue, redeemPromo } from '../src/redeem.js';
import { DAY_MS } from '../src/time.js';
import { NOW, prospect, setup } from './helpers.js';

const HOUR = 3_600_000;

async function world() {
  const s = setup();
  const c = await prospect(s.repo, { email: 'jane@agentco.example' });
  const grant = (await s.repo.insertGrant({ contact_id: c.id, grant_key: 'agentco.example', cap_cents: 2500, expires_at: new Date(NOW.getTime() + 14 * DAY_MS) }))!;
  const customer = { id: randomUUID(), name: 'AgentCo', contact_email: 'Ops@AgentCo.example' };
  s.repo.customers.push(customer);
  const job = (over: { status?: string; budget_usd?: number; created_at?: Date; customer_id?: string | null } = {}) => {
    const at = over.created_at ?? new Date(NOW.getTime() + HOUR);
    const j = {
      id: randomUUID(),
      title: 'Photograph the venue',
      instructions: '3 photos',
      certification_required: null,
      lat: 37.76,
      lng: -122.39,
      remote: false,
      status: 'paid',
      worker_id: randomUUID(),
      updated_at: at,
      customer_id: customer.id,
      budget_usd: 60,
      ...over,
      created_at: at,
    };
    s.repo.jobs.push(j);
    return j;
  };
  return { s, grant, job };
}

describe('grantKeyFor', () => {
  it('uses the company domain, or the full address at free-mail providers', () => {
    expect(grantKeyFor('Jane@AgentCo.example')).toBe('agentco.example');
    expect(grantKeyFor('jane@gmail.com')).toBe('jane@gmail.com');
  });
});

describe('redeem_promo', () => {
  it('returns the exact refund for the first paid job and reserves the grant; a retry gets the same call', async () => {
    const { s, grant, job } = await world();
    const j = job();
    const want = { eligible: true, refund: { job_id: j.id, amount_cents: 2500, request_id: `promo:${grant.id}`, reason: PROMO_REASON } };
    expect(await redeemPromo(s.deps, j.id)).toEqual(want);
    expect(await redeemPromo(s.deps, j.id)).toEqual(want);
    expect(await redeemPromo(s.deps, job({ created_at: new Date(NOW.getTime() + 2 * HOUR) }).id)).toEqual({ eligible: false, reason: 'grant_already_redeemed' });
  });

  it('refunds at most the job price', async () => {
    const { s, job } = await world();
    expect(await redeemPromo(s.deps, job({ budget_usd: 20 }).id)).toMatchObject({ eligible: true, refund: { amount_cents: 2000 } });
  });

  it('refuses unpaid, pre-offer, expired, unknown and unmatched jobs', async () => {
    const { s, job } = await world();
    expect(await redeemPromo(s.deps, job({ status: 'accepted' }).id)).toEqual({ eligible: false, reason: 'job_not_paid: status is accepted' });
    expect(await redeemPromo(s.deps, job({ created_at: new Date(NOW.getTime() + 15 * DAY_MS) }).id)).toEqual({ eligible: false, reason: 'offer_expired' });
    expect(await redeemPromo(s.deps, randomUUID())).toEqual({ eligible: false, reason: 'job_not_found' });
    const other = { id: randomUUID(), name: 'Other', contact_email: 'x@other.example' };
    s.repo.customers.push(other);
    expect(await redeemPromo(s.deps, job({ customer_id: other.id }).id)).toEqual({ eligible: false, reason: 'no_grant_for_customer' });
    expect(await redeemPromo(s.deps, job({ created_at: new Date(NOW.getTime() - HOUR) }).id)).toEqual({ eligible: false, reason: 'job_predates_offer' });
  });

  it('is not a first job when the customer already had a paid one', async () => {
    const { s, job } = await world();
    job({ created_at: new Date(NOW.getTime() + HOUR) });
    const second = job({ created_at: new Date(NOW.getTime() + 2 * HOUR) });
    expect(await redeemPromo(s.deps, second.id)).toEqual({ eligible: false, reason: 'not_first_paid_job' });
  });

  it('lists due promos until they are redeemed', async () => {
    const { s, job } = await world();
    const j = job();
    expect(await promosDue(s.deps)).toEqual([{ job_id: j.id, customer: 'AgentCo', refund_cents: 2500 }]);
    await redeemPromo(s.deps, j.id);
    expect(await promosDue(s.deps)).toEqual([]);
  });
});
