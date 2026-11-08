import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

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

// ---------- short links (current) ----------
// Old signed tokens are ~230 chars: too long for a clean email and for DM limits. Short tokens are
// 10 random chars + "-" + 8-char HMAC tag (~19 chars), e.g. operis.live/j/Xk3pQ9aB2c-7fJ2kL0q.
// The tag stops guessing; the outreach row (outreach.token) maps it to the job and worker.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function randomId(len: number): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

function tag(id: string, secret: string): string {
  return hmac(`short:${id}`, secret).toString('base64url').slice(0, 8);
}

/** New short link token. Store it in outreach.token; resolve with verifyShortToken + a DB lookup. */
export function signShortToken(secret: string): string {
  if (!secret) throw new Error('signing secret is required');
  const id = randomId(10);
  return `${id}-${tag(id, secret)}`;
}

/** True when the token is well-formed and its tag matches (constant-time). Does not check expiry. */
export function verifyShortToken(token: string, secret: string): boolean {
  if (typeof token !== 'string' || !secret) return false;
  const m = /^([A-Za-z0-9]{10})-([A-Za-z0-9_-]{8})$/.exec(token);
  if (!m) return false;
  const a = Buffer.from(tag(m[1]!, secret));
  const b = Buffer.from(m[2]!);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const SHORT_TOKEN_TTL_MS = DEFAULT_TOKEN_TTL_SECONDS * 1000;

/**
 * For apps/api's /j/[token] route: verify the tag, look up the outreach row, enforce a 7-day expiry.
 * Returns { job_id, worker_id, outreach_id } or null.
 */
export async function resolveJobToken(
  token: string,
  secret: string,
  lookup: (token: string) => Promise<{ id: string; job_id: string; worker_id: string; created_at: string } | null>,
  now: Date = new Date(),
): Promise<{ job_id: string; worker_id: string; outreach_id: string } | null> {
  if (!verifyShortToken(token, secret)) return null;
  const row = await lookup(token);
  if (!row) return null;
  if (now.getTime() - new Date(row.created_at).getTime() > SHORT_TOKEN_TTL_MS) return null;
  return { job_id: row.job_id, worker_id: row.worker_id, outreach_id: row.id };
}
