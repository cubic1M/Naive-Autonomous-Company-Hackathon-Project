import exifr from 'exifr';
import type { ProofMedia } from '../types.js';

export interface ExifData {
  lat: number | null;
  lng: number | null;
  capturedAt: Date | null;
  /** DateTimeOriginal had no OffsetTimeOriginal: interpreted as UTC */
  tzAssumed: boolean;
}

const EMPTY: ExifData = { lat: null, lng: null, capturedAt: null, tzAssumed: false };

const DATE_RE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const OFFSET_RE = /^([+-])(\d{2}):(\d{2})$/;

/**
 * Build the capture instant from EXIF's zone-less wall-clock string plus an optional offset.
 * Built from UTC components so the result never depends on the server's time zone; with no
 * offset we must guess UTC and flag it, so callers can downgrade a miss to "needs review".
 */
export function combineExifDateTime(
  dateTimeOriginal: string | undefined,
  offsetTimeOriginal: string | undefined,
): { capturedAt: Date | null; tzAssumed: boolean } {
  const m = dateTimeOriginal ? DATE_RE.exec(dateTimeOriginal.trim()) : null;
  if (!m) return { capturedAt: null, tzAssumed: false };
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const wallClockAsUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  if (Number.isNaN(wallClockAsUtc) || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) {
    return { capturedAt: null, tzAssumed: false };
  }
  const o = offsetTimeOriginal ? OFFSET_RE.exec(offsetTimeOriginal.trim()) : null;
  if (!o) return { capturedAt: new Date(wallClockAsUtc), tzAssumed: true };
  const sign = o[1] === '-' ? -1 : 1;
  const offsetMs = sign * (Number(o[2]) * 60 + Number(o[3])) * 60_000;
  return { capturedAt: new Date(wallClockAsUtc - offsetMs), tzAssumed: false };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * Pull GPS and capture time from image bytes. reviveValues is off so DateTimeOriginal stays the raw
 * string (exifr would otherwise build a local-time Date). Anything unreadable yields all-null:
 * a missing EXIF block is a review signal, not an exception.
 */
export async function readExif(bytes: Uint8Array): Promise<ExifData> {
  let tags: Record<string, unknown> | undefined;
  try {
    tags = (await exifr.parse(bytes, {
      gps: true,
      exif: true,
      reviveValues: false,
      translateValues: false,
      mergeOutput: true,
    })) as Record<string, unknown> | undefined;
  } catch {
    return { ...EMPTY };
  }
  if (!tags) return { ...EMPTY };
  const lat = typeof tags.latitude === 'number' && Number.isFinite(tags.latitude) ? tags.latitude : null;
  const lng = typeof tags.longitude === 'number' && Number.isFinite(tags.longitude) ? tags.longitude : null;
  const { capturedAt, tzAssumed } = combineExifDateTime(str(tags.DateTimeOriginal), str(tags.OffsetTimeOriginal));
  return { lat, lng, capturedAt, tzAssumed };
}

export type ReadMedia = (media: ProofMedia) => Promise<Uint8Array>;

/** Download proof media over HTTP; a non-2xx is an error so callers can record "unreadable". */
export function fetchMedia(fetchImpl: typeof fetch = fetch): ReadMedia {
  return async (media) => {
    const res = await fetchImpl(media.url);
    if (!res.ok) throw new Error(`media fetch failed: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
}
