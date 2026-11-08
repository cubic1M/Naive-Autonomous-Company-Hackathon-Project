/**
 * Signed links in growth emails: the one-click unsubscribe link (never expires) and the Recruiter's join link
 * (30 days). Token = `<u|j>.<contact id>.<expiry, unix seconds; 0 = never>.<mac>`: opaque, with no email or name
 * in the URL. The MAC is HMAC-SHA256 over "growth:" plus the first three parts, so a job-link signature made with
 * the same secret can never pass here.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type LinkPurpose = 'unsubscribe' | 'join';
export const JOIN_TTL_DAYS = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tag = (p: LinkPurpose) => (p === 'unsubscribe' ? 'u' : 'j');
const mac = (secret: string, body: string) => createHmac('sha256', secret).update(`growth:${body}`).digest('base64url').slice(0, 22);

export function signLink(secret: string, purpose: LinkPurpose, contactId: string, now: Date = new Date()): string {
  const exp = purpose === 'join' ? Math.floor(now.getTime() / 1000) + JOIN_TTL_DAYS * 86_400 : 0;
  const body = `${tag(purpose)}.${contactId}.${exp}`;
  return `${body}.${mac(secret, body)}`;
}

/** The contact id inside a valid, unexpired token for `purpose`; null otherwise. */
export function verifyLink(secret: string, token: string | null | undefined, purpose: LinkPurpose, now: Date = new Date()): string | null {
  const parts = (token ?? '').split('.');
  if (parts.length !== 4) return null;
  const [t, id, expRaw, sig] = parts as [string, string, string, string];
  if (t !== tag(purpose) || !UUID.test(id) || !/^\d+$/.test(expRaw)) return null;
  const want = Buffer.from(mac(secret, `${t}.${id}.${expRaw}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const exp = Number(expRaw);
  if (exp !== 0 && exp * 1000 < now.getTime()) return null;
  return id.toLowerCase();
}

export const unsubscribeUrl = (base: string, token: string): string => `${base}/v1/growth/unsubscribe?t=${token}`;
export const joinUrl = (base: string, token: string): string => `${base}/v1/growth/join?t=${token}`;
