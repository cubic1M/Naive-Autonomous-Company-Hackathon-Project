import type { Channel, Person } from './types.js';

/**
 * How we may contact a person, or null if we may not.
 * - Never anyone who opted out.
 * - SMS only for regulars who explicitly consented (US texting law); never cold SMS.
 * - Otherwise email, if we have a public work email.
 */
export function pickChannel(p: Pick<Person, 'opted_out' | 'regular' | 'sms_consent' | 'phone' | 'email'>): Channel | null {
  if (p.opted_out) return null;
  if (p.regular && p.sms_consent && p.phone) return 'sms';
  if (p.email) return 'email';
  return null;
}
