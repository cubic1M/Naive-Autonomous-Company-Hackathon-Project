import type { Channel, ManualPlatform, Person, Profile } from './types.js';

/** DM platforms in priority order: where a recruiter message is most expected and welcome. */
export const MANUAL_PRIORITY: ManualPlatform[] = ['linkedin', 'x', 'reddit', 'instagram'];

export function manualPlatform(channel: Channel | null): ManualPlatform | null {
  return channel && channel.endsWith('_manual') ? (channel.slice(0, -'_manual'.length) as ManualPlatform) : null;
}

/** The profile to DM on a platform, if the person has one. */
export function manualProfile(p: Pick<Person, 'profiles'>, platform: ManualPlatform): Profile | null {
  return p.profiles.find((x) => x.platform === platform) ?? null;
}

/**
 * How we may contact a person, or null if we may not.
 * - Never anyone who opted out.
 * - SMS only for regulars who explicitly consented (US texting law); never cold SMS.
 * - Otherwise email, if we have a public work email.
 * - Otherwise a drafted DM for a teammate to send by hand (linkedin > x > reddit > instagram).
 */
export function pickChannel(
  p: Pick<Person, 'opted_out' | 'regular' | 'sms_consent' | 'phone' | 'email' | 'profiles'>,
  opts: { allowManual?: boolean } = {},
): Channel | null {
  if (p.opted_out) return null;
  if (p.regular && p.sms_consent && p.phone) return 'sms';
  if (p.email) return 'email';
  if (opts.allowManual === false) return null; // autonomous mode: only channels we can send ourselves
  for (const platform of MANUAL_PRIORITY) {
    if (manualProfile(p, platform)) return `${platform}_manual`;
  }
  return null;
}
