import { describe, expect, it } from 'vitest';
import { manualPlatform, pickChannel } from '../src/channel.js';
import type { Profile } from '../src/types.js';

const li: Profile = { platform: 'linkedin', url: 'https://www.linkedin.com/in/j', handle: 'j' };
const x: Profile = { platform: 'x', url: 'https://x.com/j', handle: 'j' };
const rd: Profile = { platform: 'reddit', url: 'https://www.reddit.com/user/j', handle: 'j' };
const ig: Profile = { platform: 'instagram', url: 'https://www.instagram.com/j', handle: 'j' };
const gh: Profile = { platform: 'github', url: 'https://github.com/j', handle: 'j' };
const p = (o: Record<string, unknown> = {}) => ({ opted_out: false, regular: false, sms_consent: false, phone: null, email: null, profiles: [] as Profile[], ...o });

describe('pickChannel', () => {
  it('opted out is always null', () => {
    expect(pickChannel(p({ opted_out: true, email: 'a@b.co', profiles: [li] }))).toBeNull();
  });
  it('sms only for consenting regulars with a phone', () => {
    expect(pickChannel(p({ regular: true, sms_consent: true, phone: '+14155550142', email: 'a@b.co' }))).toBe('sms');
    expect(pickChannel(p({ regular: true, phone: '+14155550142', email: 'a@b.co' }))).toBe('email');
    expect(pickChannel(p({ sms_consent: true, phone: '+14155550142', email: 'a@b.co' }))).toBe('email');
  });
  it('email beats DM', () => {
    expect(pickChannel(p({ email: 'a@b.co', profiles: [li] }))).toBe('email');
  });
  it('DM priority linkedin > x > reddit > instagram', () => {
    expect(pickChannel(p({ profiles: [ig, rd, x, li] }))).toBe('linkedin_manual');
    expect(pickChannel(p({ profiles: [ig, rd, x] }))).toBe('x_manual');
    expect(pickChannel(p({ profiles: [ig, rd] }))).toBe('reddit_manual');
    expect(pickChannel(p({ profiles: [ig] }))).toBe('instagram_manual');
  });
  it('github/website-only profiles and phone-only non-regulars are not reachable', () => {
    expect(pickChannel(p({ profiles: [gh] }))).toBeNull();
    expect(pickChannel(p({ phone: '+14155550142' }))).toBeNull();
    expect(pickChannel(p())).toBeNull();
  });
  it('manualPlatform maps channels', () => {
    expect(manualPlatform('linkedin_manual')).toBe('linkedin');
    expect(manualPlatform('instagram_manual')).toBe('instagram');
    expect(manualPlatform('email')).toBeNull();
    expect(manualPlatform('sms')).toBeNull();
    expect(manualPlatform(null)).toBeNull();
  });
});

describe('autonomous mode', () => {
  it('never picks a manual DM channel when the manual queue is off', async () => {
    const { pickChannel } = await import('../src/channel.js');
    const p = { opted_out: false, regular: false, sms_consent: false, phone: null, email: null, profiles: [{ platform: 'linkedin' as const, url: 'https://www.linkedin.com/in/x', handle: 'x' }] };
    expect(pickChannel(p)).toBe('linkedin_manual');
    expect(pickChannel(p, { allowManual: false })).toBeNull();
    expect(pickChannel({ ...p, email: 'a@b.com' }, { allowManual: false })).toBe('email');
  });
});
