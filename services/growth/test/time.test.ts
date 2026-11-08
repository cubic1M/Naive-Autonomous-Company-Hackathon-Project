import { describe, expect, it } from 'vitest';
import { pacificDate, pacificDayStart, shortDate } from '../src/time.js';

describe('Pacific time helpers', () => {
  it('starts the day at midnight Pacific', () => {
    expect(pacificDayStart(new Date('2026-11-08T05:30:00Z')).toISOString()).toBe('2026-11-07T08:00:00.000Z');
    expect(pacificDayStart(new Date('2026-11-08T18:00:00Z')).toISOString()).toBe('2026-11-08T08:00:00.000Z');
  });

  it('formats dates for reports and email copy', () => {
    expect(pacificDate(new Date('2026-11-08T05:30:00Z'))).toBe('2026-11-07');
    expect(shortDate(new Date('2026-11-22T18:00:00Z'))).toBe('Sun Nov 22');
  });
});
