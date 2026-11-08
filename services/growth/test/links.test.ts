import { describe, expect, it } from 'vitest';
import { joinUrl, signLink, unsubscribeUrl, verifyLink } from '../src/links.js';

const ID = '0b6f3c1e-8d2a-4c7b-9a1e-2f3d4c5b6a79';

describe('signed links', () => {
  it('unsubscribe tokens never expire', () => {
    const t = signLink('s', 'unsubscribe', ID, new Date('2026-01-01T00:00:00Z'));
    expect(verifyLink('s', t, 'unsubscribe', new Date('2036-01-01T00:00:00Z'))).toBe(ID);
  });

  it('join tokens last 30 days', () => {
    const t = signLink('s', 'join', ID, new Date('2026-11-08T00:00:00Z'));
    expect(verifyLink('s', t, 'join', new Date('2026-12-07T00:00:00Z'))).toBe(ID);
    expect(verifyLink('s', t, 'join', new Date('2026-12-09T00:00:00Z'))).toBeNull();
  });

  it('rejects the other purpose, a tampered id, the wrong secret and junk', () => {
    const u = signLink('s', 'unsubscribe', ID);
    expect(verifyLink('s', u, 'join')).toBeNull();
    expect(verifyLink('s', u.replace(ID, ID.replace('0b6f', '1b6f')), 'unsubscribe')).toBeNull();
    expect(verifyLink('other', u, 'unsubscribe')).toBeNull();
    expect(verifyLink('s', 'garbage', 'unsubscribe')).toBeNull();
    expect(verifyLink('s', null, 'unsubscribe')).toBeNull();
  });

  it('builds URLs with no email in them', () => {
    const url = unsubscribeUrl('https://operis.live', signLink('s', 'unsubscribe', ID));
    expect(url).toMatch(/^https:\/\/operis\.live\/v1\/growth\/unsubscribe\?t=u\./);
    expect(url).not.toContain('@');
    expect(joinUrl('https://operis.live', 'x')).toBe('https://operis.live/v1/growth/join?t=x');
  });
});
