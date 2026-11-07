import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { combineExifDateTime, fetchMedia, readExif } from '../src/proof/exif.js';

const fixture = () => new Uint8Array(readFileSync(new URL('./fixtures/proof-gps.jpg', import.meta.url)));

describe('combineExifDateTime', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('applies the offset', () => {
    const r = combineExifDateTime('2026:11:07 09:30:00', '-08:00');
    expect(r.capturedAt?.toISOString()).toBe('2026-11-07T17:30:00.000Z');
    expect(r.tzAssumed).toBe(false);
  });

  it('assumes UTC without an offset and says so', () => {
    const r = combineExifDateTime('2026:11:07 17:30:00', undefined);
    expect(r.capturedAt?.toISOString()).toBe('2026-11-07T17:30:00.000Z');
    expect(r.tzAssumed).toBe(true);
  });

  it('returns null for garbage', () => {
    expect(combineExifDateTime('not a date', '-08:00')).toEqual({ capturedAt: null, tzAssumed: false });
    expect(combineExifDateTime(undefined, undefined)).toEqual({ capturedAt: null, tzAssumed: false });
  });

  it('does not depend on the server time zone', () => {
    process.env.TZ = 'UTC';
    const utc = combineExifDateTime('2026:11:07 17:30:00', undefined).capturedAt?.toISOString();
    process.env.TZ = 'America/Los_Angeles';
    const la = combineExifDateTime('2026:11:07 17:30:00', undefined).capturedAt?.toISOString();
    expect(la).toBe(utc);
    expect(la).toBe('2026-11-07T17:30:00.000Z');
  });
});

describe('readExif', () => {
  it('reads GPS and capture time from the real fixture', async () => {
    const exif = await readExif(fixture());
    expect(exif.lat).toBeCloseTo(37.7749, 3);
    expect(Math.abs((exif.lat ?? 0) - 37.7749)).toBeLessThan(1e-4);
    expect(Math.abs((exif.lng ?? 0) - -122.4194)).toBeLessThan(1e-4);
    expect(exif.capturedAt?.toISOString()).toBe('2026-11-07T17:30:00.000Z');
  });

  it('returns all-null for non-image bytes without throwing', async () => {
    const junk = new Uint8Array(256).map((_, i) => (i * 37 + 11) % 256);
    expect(await readExif(junk)).toEqual({ lat: null, lng: null, capturedAt: null, tzAssumed: false });
  });
});

describe('fetchMedia', () => {
  const media = { url: 'https://blob.test/a.jpg', sha256: 'x', mime: 'image/jpeg' };
  it('returns bytes on 200 and throws on non-2xx', async () => {
    const ok = fetchMedia((async () => new Response(new Uint8Array([1, 2, 3]))) as typeof fetch);
    expect(Array.from(await ok(media))).toEqual([1, 2, 3]);
    const bad = fetchMedia((async () => new Response('no', { status: 404 })) as typeof fetch);
    await expect(bad(media)).rejects.toThrow(/404/);
  });
});
