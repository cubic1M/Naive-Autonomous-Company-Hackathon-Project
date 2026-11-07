import { createHmac, timingSafeEqual } from 'node:crypto';

export interface JobTokenClaims {
  job_id: string;
  worker_id: string;
  outreach_nonce: string;
}

export interface VerifiedJobToken extends JobTokenClaims {
  /** Expiry, unix seconds. */
  exp: number;
}

export const DEFAULT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const b64u = (buf: Buffer | string): string => Buffer.from(buf).toString('base64url');
const hmac = (data: string, secret: string): Buffer => createHmac('sha256', secret).update(data).digest();

/** Signed job link token: base64url(JSON {j,w,n,e}) + "." + base64url(HMAC-SHA256). */
export function signJobToken(
  claims: JobTokenClaims,
  secret: string,
  ttlSeconds: number = DEFAULT_TOKEN_TTL_SECONDS,
  now: Date = new Date(),
): string {
  if (!secret) throw new Error('signing secret is required');
  const e = Math.floor(now.getTime() / 1000) + Math.floor(ttlSeconds);
  const payload = b64u(JSON.stringify({ j: claims.job_id, w: claims.worker_id, n: claims.outreach_nonce, e }));
  return `${payload}.${b64u(hmac(payload, secret))}`;
}

/** Returns the claims, or null if the token is malformed, tampered with, or expired. */
export function verifyJobToken(token: string, secret: string, now: Date = new Date()): VerifiedJobToken | null {
  if (typeof token !== 'string' || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, sig] = parts as [string, string];
  const expected = hmac(payload, secret);
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof p.j !== 'string' || typeof p.w !== 'string' || typeof p.n !== 'string' || typeof p.e !== 'number') return null;
    if (Math.floor(now.getTime() / 1000) >= p.e) return null;
    return { job_id: p.j, worker_id: p.w, outreach_nonce: p.n, exp: p.e };
  } catch {
    return null;
  }
}

export function jobLink(base: string, token: string): string {
  return `${base.replace(/\/+$/, '')}/j/${token}`;
}
