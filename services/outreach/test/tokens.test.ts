import { describe, expect, it } from 'vitest';
import { jobLink, signJobToken, verifyJobToken } from '../src/tokens.js';

const claims = { job_id: 'job-1', worker_id: 'w-1', outreach_nonce: 'abc' };
const t0 = new Date('2026-01-01T00:00:00Z');

describe('job tokens', () => {
  it('round-trips', () => {
    const tok = signJobToken(claims, 's3cret', 60, t0);
    const v = verifyJobToken(tok, 's3cret', new Date(t0.getTime() + 30_000));
    expect(v).toEqual({ ...claims, exp: Math.floor(t0.getTime() / 1000) + 60 });
  });
  it('rejects expired', () => {
    const tok = signJobToken(claims, 's3cret', 60, t0);
    expect(verifyJobToken(tok, 's3cret', new Date(t0.getTime() + 61_000))).toBeNull();
  });
  it('rejects wrong secret', () => {
    expect(verifyJobToken(signJobToken(claims, 'a', 60, t0), 'b', t0)).toBeNull();
  });
  it('rejects tampered payload', () => {
    const tok = signJobToken(claims, 's', 60, t0);
    const [, sig] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({ j: 'other', w: 'w-1', n: 'abc', e: 9999999999 })).toString('base64url');
    expect(verifyJobToken(`${forged}.${sig}`, 's', t0)).toBeNull();
  });
  it('rejects malformed input', () => {
    for (const bad of ['', 'abc', 'a.b.c', '.', 'a.', '.b', '!!!.???']) expect(verifyJobToken(bad, 's', t0)).toBeNull();
  });
  it('defaults to 7 days and is short', () => {
    const tok = signJobToken(claims, 's', undefined, t0);
    expect(verifyJobToken(tok, 's', new Date(t0.getTime() + 6 * 86400_000))).not.toBeNull();
    expect(verifyJobToken(tok, 's', new Date(t0.getTime() + 8 * 86400_000))).toBeNull();
  });
  it('builds links', () => {
    expect(jobLink('https://x.test/', 'T')).toBe('https://x.test/j/T');
  });
});
