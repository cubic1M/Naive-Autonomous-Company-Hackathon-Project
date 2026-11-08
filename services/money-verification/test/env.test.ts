import { describe, expect, it } from 'vitest';
import { envFromProcess } from '../src/env.js';

const base = { PUBLIC_BASE_URL: 'https://operis.test/', STRIPE_WEBHOOK_SECRET: 'whsec_x' };

describe('envFromProcess: IDENTITY_GATE', () => {
  it('defaults to log until the job page can get every worker verified, the way PAYOUT_CAP_CENTS defaults to 15000', () => {
    expect(envFromProcess(base)).toMatchObject({ IDENTITY_GATE: 'log', PAYOUT_CAP_CENTS: 15_000 });
    expect(envFromProcess({ ...base, IDENTITY_GATE: '' }).IDENTITY_GATE).toBe('log');
  });

  it('reads enforce and log, case and spaces aside', () => {
    expect(envFromProcess({ ...base, IDENTITY_GATE: 'enforce' }).IDENTITY_GATE).toBe('enforce');
    expect(envFromProcess({ ...base, IDENTITY_GATE: ' Enforce ' }).IDENTITY_GATE).toBe('enforce');
    expect(envFromProcess({ ...base, IDENTITY_GATE: 'LOG' }).IDENTITY_GATE).toBe('log');
  });

  it('refuses anything else instead of guessing', () => {
    expect(() => envFromProcess({ ...base, IDENTITY_GATE: 'on' })).toThrow(/invalid IDENTITY_GATE value: on/);
  });
});
