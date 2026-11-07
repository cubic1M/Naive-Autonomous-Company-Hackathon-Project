import type { Repo } from '../repo.js';
import type { Job, Proof, ProofCheck, ProofCheckStatus, ProofMedia } from '../types.js';
import { readExif as defaultReadExif, type ExifData, type ReadMedia } from './exif.js';

export const DEFAULT_GEOFENCE_M = 150;
export const GPS_DISAGREEMENT_M = 150;
export const EARLY_TOLERANCE_MS = 10 * 60_000;

export interface MediaExif {
  media: ProofMedia;
  exif: ExifData | null;
}

function check(name: string, status: ProofCheckStatus, detail: string, data?: Record<string, unknown>): ProofCheck {
  return { name, status, pass: status === 'pass', detail, ...(data ? { data } : {}) };
}

/** Great-circle distance in meters; accurate to well under a meter at geofence scale. */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Geofence against EXIF GPS (hard to fake casually) with the device GPS as fallback. When both exist
 * and disagree we flag it: one of them is wrong or spoofed, and a human should look.
 */
export function geofenceChecks(job: Job, proof: Proof, exifs: MediaExif[]): ProofCheck[] {
  const out: ProofCheck[] = [];
  const exifPoint = exifs.find((e) => e.exif && e.exif.lat !== null && e.exif.lng !== null)?.exif;
  const exifGps = exifPoint ? { lat: exifPoint.lat as number, lng: exifPoint.lng as number } : null;
  const deviceGps =
    proof.gps_lat !== null && proof.gps_lng !== null ? { lat: proof.gps_lat, lng: proof.gps_lng } : null;

  if (exifGps && deviceGps) {
    const gap = haversineMeters(exifGps, deviceGps);
    if (gap > GPS_DISAGREEMENT_M) {
      out.push(
        check('gps_consistency', 'needs_review', `EXIF and device GPS differ by ${Math.round(gap)} m (limit ${GPS_DISAGREEMENT_M} m)`),
      );
    }
  }

  const point = exifGps ?? deviceGps;
  if (!point) {
    out.push(check('geofence', 'needs_review', 'no GPS in EXIF or device data'));
    return out;
  }
  const limit = job.proof_schema.geofence_m ?? DEFAULT_GEOFENCE_M;
  const dist = haversineMeters(point, { lat: job.lat, lng: job.lng });
  const source = exifGps ? 'EXIF' : 'device';
  out.push(
    check('geofence', dist <= limit ? 'pass' : 'fail', `${Math.round(dist)} m from job (limit ${limit} m, ${source} GPS)`, {
      distance_m: Math.round(dist),
      limit_m: limit,
      source,
    }),
  );
  return out;
}

/**
 * Every photo must have been taken between acceptance and the deadline. A zone-less EXIF time that
 * lands outside is only "needs_review": we may have misread local time as UTC.
 */
export function timeCheck(job: Job, exifs: MediaExif[]): ProofCheck {
  if (!job.accepted_at) return check('time', 'needs_review', 'job has no accepted_at; cannot bound capture time');
  const start = job.accepted_at.getTime() - EARLY_TOLERANCE_MS;
  const end = job.deadline.getTime();
  const timed = exifs.filter((e) => e.exif?.capturedAt);
  if (timed.length === 0) return check('time', 'needs_review', 'missing EXIF capture time');

  let status: ProofCheckStatus = 'pass';
  const notes: string[] = [];
  for (const e of timed) {
    const exif = e.exif as ExifData;
    const t = (exif.capturedAt as Date).getTime();
    if (t >= start && t <= end) continue;
    const when = (exif.capturedAt as Date).toISOString();
    if (exif.tzAssumed) {
      if (status === 'pass') status = 'needs_review';
      notes.push(`${when} outside window (EXIF had no time zone; assumed UTC)`);
    } else {
      status = 'fail';
      notes.push(`${when} outside window`);
    }
  }
  const missing = exifs.length - timed.length;
  if (missing > 0 && status === 'pass') {
    status = 'needs_review';
    notes.push(`${missing} image(s) missing EXIF capture time`);
  }
  if (notes.length === 0) return check('time', 'pass', `${timed.length} capture time(s) within window`);
  return check('time', status, notes.join('; '));
}

const FIELD_TYPES = new Set(['string', 'number', 'boolean']);

/** Cheap structural check: enough photos, and every required field present with the right type. */
export function completenessCheck(job: Job, proof: Proof): ProofCheck {
  const problems: string[] = [];
  const images = proof.media.filter((m) => m.mime.startsWith('image/')).length;
  const min = job.proof_schema.photos.min;
  if (images < min) problems.push(`${images} image(s), need ${min}`);
  for (const f of job.proof_schema.fields ?? []) {
    const v = proof.fields[f.name];
    if (v === undefined || v === null) problems.push(`missing field ${f.name}`);
    else if (FIELD_TYPES.has(f.type) && typeof v !== f.type) problems.push(`field ${f.name} should be ${f.type}`);
  }
  return problems.length === 0
    ? check('completeness', 'pass', `${images} image(s), required fields present`)
    : check('completeness', 'fail', problems.join('; '));
}

/** The same file submitted for a different job is the cheapest fraud there is; re-upload on the same job is fine. */
export async function reuseCheck(repo: Pick<Repo, 'findProofsByMediaSha256'>, proof: Proof): Promise<ProofCheck> {
  for (const m of proof.media) {
    if (!m.sha256) continue; // contract media rows carry no hash yet; nothing to compare
    const hits = await repo.findProofsByMediaSha256(m.sha256);
    const other = hits.find((p) => p.job_id !== proof.job_id);
    if (other) return check('reuse', 'fail', `media ${m.sha256.slice(0, 8)} already used on job ${other.job_id}`);
  }
  return check('reuse', 'pass', 'no media reused from other jobs');
}

export interface ChecksDeps {
  repo: Pick<Repo, 'findProofsByMediaSha256'>;
  readMedia?: ReadMedia;
  readExif?: (bytes: Uint8Array) => Promise<ExifData>;
}

/** EXIF for image media only. A failed download must never abort a review, so it degrades to exif: null. */
export async function loadExif(deps: ChecksDeps, proof: Proof): Promise<MediaExif[]> {
  const parse = deps.readExif ?? defaultReadExif;
  const images = proof.media.filter((m) => m.mime.startsWith('image/'));
  return Promise.all(
    images.map(async (media): Promise<MediaExif> => {
      if (!deps.readMedia) return { media, exif: null };
      try {
        return { media, exif: await parse(await deps.readMedia(media)) };
      } catch {
        return { media, exif: null };
      }
    }),
  );
}

export async function runChecks(
  deps: ChecksDeps,
  job: Job,
  proof: Proof,
): Promise<{ checks: ProofCheck[]; exifs: MediaExif[] }> {
  const exifs = await loadExif(deps, proof);
  const reuse = await reuseCheck(deps.repo, proof);
  const checks = [reuse, completenessCheck(job, proof), ...geofenceChecks(job, proof, exifs), timeCheck(job, exifs)];
  return { checks, exifs };
}
