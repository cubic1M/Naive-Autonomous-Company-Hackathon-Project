import { describe, expect, it } from 'vitest';
import { MoneyVerificationError } from '../src/errors.js';
import { modeOfLivemode, stripeModeFromEnv, stripeModeOfKey } from '../src/stripe-mode.js';

describe('stripeModeOfKey', () => {
  it('reads live and test from secret and restricted key prefixes', () => {
    expect(stripeModeOfKey('sk_live_abc')).toBe('live');
    expect(stripeModeOfKey('rk_live_abc')).toBe('live');
    expect(stripeModeOfKey('sk_test_abc')).toBe('test');
    expect(stripeModeOfKey('rk_test_abc')).toBe('test');
  });

  it('refuses anything else, without echoing the value', () => {
    for (const bad of ['pk_live_abc', 'whsec_abc', 'sk_abc', '']) {
      expect(() => stripeModeOfKey(bad)).toThrow(MoneyVerificationError);
    }
    try {
      stripeModeOfKey('pk_live_SECRETISH');
    } catch (e) {
      expect((e as Error).message).not.toContain('SECRETISH');
    }
  });
});

describe('stripeModeFromEnv', () => {
  it('uses STRIPE_SECRET_KEY, and test when it is unset (the read-only tools run without a key)', () => {
    expect(stripeModeFromEnv({ STRIPE_SECRET_KEY: 'rk_live_x' })).toBe('live');
    expect(stripeModeFromEnv({ STRIPE_SECRET_KEY: 'sk_test_x' })).toBe('test');
    expect(stripeModeFromEnv({})).toBe('test');
  });
});

describe('modeOfLivemode', () => {
  it('maps the stored stripe_livemode flag; null or absent (rows from before migration 0005) is test', () => {
    expect(modeOfLivemode(true)).toBe('live');
    expect(modeOfLivemode(false)).toBe('test');
    expect(modeOfLivemode(null)).toBe('test');
    expect(modeOfLivemode(undefined)).toBe('test');
  });
});
