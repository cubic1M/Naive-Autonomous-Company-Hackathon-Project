import { describe, expect, it } from 'vitest';
import { envFromProcess } from '../src/env.js';

const base = { PUBLIC_BASE_URL: 'https://operis.test/', STRIPE_WEBHOOK_SECRET: 'whsec_x' };

describe('envFromProcess: IDENTITY_GATE', () => {
  it('defaults to enforce: every job needs a verified identity unless log is set on purpose', () => {
    expect(envFromProcess(base)).toMatchObject({ IDENTITY_GATE: 'enforce', PAYOUT_CAP_CENTS: 15_000 });
    expect(envFromProcess({ ...base, IDENTITY_GATE: '' }).IDENTITY_GATE).toBe('enforce');
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
