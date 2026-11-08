import { describe, expect, it } from 'vitest';
import {
  completenessCheck,
  geofenceChecks,
  haversineMeters,
  runChecks,
  reuseCheck,
  timeCheck,
  type MediaExif,
} from '../src/proof/checks.js';
import type { ExifData } from '../src/proof/exif.js';
import type { Job, Proof, ProofCheck } from '../src/types.js';
import { HOUR_MS, MINUTE_MS, T0, YC, makeJob, makeProof, makeWorld } from './helpers.js';

/** ~111,195 m per degree of latitude on the 6,371 km sphere. */
const metersNorth = (m: number) => YC.lat + m / 111_195;

const exifAt = (lat: number | null, lng: number | null, capturedAt: Date | null = null, tzAssumed = false): ExifData => ({
  lat,
  lng,
  capturedAt,
  tzAssumed,
});

function withExif(proof: Proof, exif: ExifData | null): MediaExif[] {
  return proof.media.map((media) => ({ media, exif }));
}

const byName = (checks: ProofCheck[], name: string) => checks.find((c) => c.name === name);

describe('haversineMeters', () => {
  it('measures 100 m north', () => {
    const d = haversineMeters(YC, { lat: metersNorth(100), lng: YC.lng });
    expect(Math.abs(d - 100)).toBeLessThan(2);
  });
  it('measures SF to LA (~559 km)', () => {
    const d = haversineMeters(YC, { lat: 34.0522, lng: -118.2437 });
    expect(d / 1000).toBeGreaterThan(555);
    expect(d / 1000).toBeLessThan(563);
  });
});

describe('geofenceChecks', () => {
  const job = makeJob();
  const proof = makeProof({ gps_lat: null, gps_lng: null });

  it('passes at 100 m (EXIF GPS)', () => {
    const [c] = geofenceChecks(job, proof, withExif(proof, exifAt(metersNorth(100), YC.lng)));
    expect(c?.name).toBe('geofence');
    expect(c?.status).toBe('pass');
    expect(c?.pass).toBe(true);
    expect(c?.detail).toMatch(/limit 150 m/);
  });

  it('fails at 300 m', () => {
    const [c] = geofenceChecks(job, proof, withExif(proof, exifAt(metersNorth(300), YC.lng)));
    expect(c?.status).toBe('fail');
    expect(c?.pass).toBe(false);
  });

  it('honours a custom geofence_m', () => {
    const tight = makeJob({ proof_schema: { photos: { min: 1, must_show: [] }, geofence_m: 50 } });
    const [c] = geofenceChecks(tight, proof, withExif(proof, exifAt(metersNorth(100), YC.lng)));
    expect(c?.status).toBe('fail');
  });

  it('falls back to device GPS when EXIF has none', () => {
    const p = makeProof({ gps_lat: metersNorth(100), gps_lng: YC.lng });
    const checks = geofenceChecks(job, p, withExif(p, exifAt(null, null)));
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe('pass');
  });

  it('flags gps_consistency when EXIF and device differ by more than 150 m', () => {
    const p = makeProof({ gps_lat: metersNorth(120), gps_lng: YC.lng });
    const checks = geofenceChecks(job, p, withExif(p, exifAt(metersNorth(-100), YC.lng)));
    expect(byName(checks, 'gps_consistency')?.status).toBe('needs_review');
    expect(byName(checks, 'geofence')?.status).toBe('pass');
  });

  it('needs review when there is no GPS anywhere', () => {
    const [c] = geofenceChecks(job, proof, withExif(proof, null));
    expect(c?.name).toBe('geofence');
    expect(c?.status).toBe('needs_review');
  });
});

describe('timeCheck', () => {
  const job = makeJob(); // accepted T0 - 1h, deadline T0 + 4h
  const proof = makeProof();
  const at = (d: Date, tzAssumed = false) => withExif(proof, exifAt(null, null, d, tzAssumed));

  it('passes inside the window', () => {
    expect(timeCheck(job, at(new Date(T0.getTime() - 30 * MINUTE_MS))).status).toBe('pass');
  });
  it('allows 10 minutes early, fails earlier', () => {
    const accepted = job.accepted_at as Date;
    expect(timeCheck(job, at(new Date(accepted.getTime() - 9 * MINUTE_MS))).status).toBe('pass');
    expect(timeCheck(job, at(new Date(accepted.getTime() - 11 * MINUTE_MS))).status).toBe('fail');
  });
  it('fails after the deadline', () => {
    expect(timeCheck(job, at(new Date(job.deadline.getTime() + MINUTE_MS))).status).toBe('fail');
  });
  it('downgrades an out-of-window time to needs_review when the zone was assumed', () => {
    const c = timeCheck(job, at(new Date(job.deadline.getTime() + HOUR_MS), true));
    expect(c.status).toBe('needs_review');
    expect(c.detail).toMatch(/assumed UTC/);
  });
  it('needs review without any EXIF time', () => {
    const c = timeCheck(job, withExif(proof, exifAt(null, null)));
    expect(c.status).toBe('needs_review');
    expect(c.detail).toMatch(/missing EXIF capture time/);
  });
  it('falls back to the 24h before the deadline without accepted_at (shared schema has no column yet)', () => {
    const c = timeCheck(makeJob({ accepted_at: null }), at(T0));
    expect(c.status).toBe('pass');
    expect(c.detail).toContain('no accepted_at');
    // 30h before the deadline is outside the fallback window
    expect(timeCheck(makeJob({ accepted_at: null }), at(new Date(T0.getTime() + 4 * HOUR_MS - 30 * HOUR_MS))).status).toBe('fail');
  });
});

describe('completenessCheck', () => {
  const img = (n: number) => ({ url: `https://blob.test/${n}.jpg`, sha256: String(n).repeat(64).slice(0, 64), mime: 'image/jpeg' });
  it('fails with too few images', () => {
    const job = makeJob({ proof_schema: { photos: { min: 2, must_show: [] } } });
    const c = completenessCheck(job, makeProof({ media: [img(1)] }));
    expect(c.status).toBe('fail');
    expect(c.detail).toMatch(/need 2/);
  });
  it('passes with enough images', () => {
    const job = makeJob({ proof_schema: { photos: { min: 2, must_show: [] } } });
    expect(completenessCheck(job, makeProof({ media: [img(1), img(2)] })).status).toBe('pass');
  });
  it('fails on a wrong-typed or missing field', () => {
    const job: Job = makeJob({
      proof_schema: { photos: { min: 1, must_show: [] }, fields: [{ name: 'count', type: 'number' }] },
    });
    expect(completenessCheck(job, makeProof({ fields: { count: '3' } })).status).toBe('fail');
    expect(completenessCheck(job, makeProof({ fields: {} })).status).toBe('fail');
    expect(completenessCheck(job, makeProof({ fields: { count: 3 } })).status).toBe('pass');
  });
});

describe('reuseCheck', () => {
  it('fails when the same sha256 is on another job', async () => {
    const w = makeWorld();
    const mine = makeProof();
    w.repo.seedProof(mine);
    w.repo.seedProof(makeProof({ id: 'other-proof', job_id: 'other-job' }));
    const c = await reuseCheck(w.repo, mine);
    expect(c.status).toBe('fail');
    expect(c.detail).toContain('other-job');
    expect(c.detail).toContain('aaaaaaaa');
  });
  it('passes for a re-upload on the same job', async () => {
    const w = makeWorld();
    const mine = makeProof();
    w.repo.seedProof(mine);
    w.repo.seedProof(makeProof({ id: 'second-proof' }));
    expect((await reuseCheck(w.repo, mine)).status).toBe('pass');
  });
});

describe('runChecks', () => {
  it('survives a failing download and records exif: null', async () => {
    const w = makeWorld();
    const proof = makeProof();
    w.repo.seedProof(proof);
    const { exifs, checks } = await runChecks(
      { repo: w.repo, readMedia: async () => { throw new Error('boom'); } },
      makeJob(),
      proof,
    );
    expect(exifs[0]?.exif).toBeNull();
    expect(byName(checks, 'time')?.status).toBe('needs_review');
    expect(byName(checks, 'geofence')?.status).toBe('pass'); // device GPS fallback
  });
});
