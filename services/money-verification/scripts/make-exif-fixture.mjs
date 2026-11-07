// Generates test/fixtures/proof-gps.jpg: a tiny 16x16 JPEG with GPS (YC office, SF) and a capture time.
// piexifjs has no OffsetTimeOriginal (0x9011) in its tag table, so we cannot write the offset. Fallback:
// DateTimeOriginal '2026:11:07 17:30:00' with no offset, which readExif interprets as UTC
// (tzAssumed: true) = 2026-11-07T17:30:00Z, the same instant as 09:30 at -08:00 (T0 - 30 min).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jpeg = require('jpeg-js');
const piexif = require('piexifjs');

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../test/fixtures/proof-gps.jpg');

const size = 16;
const data = Buffer.alloc(size * size * 4);
for (let i = 0; i < size * size; i++) {
  data[i * 4] = (i * 7) % 256;
  data[i * 4 + 1] = (i * 3) % 256;
  data[i * 4 + 2] = 128;
  data[i * 4 + 3] = 255;
}
const raw = jpeg.encode({ data, width: size, height: size }, 80).data;
const binary = raw.toString('binary');

const lat = 37.7749;
const lng = 122.4194;
const exif = {
  '0th': {},
  Exif: { [piexif.ExifIFD.DateTimeOriginal]: '2026:11:07 17:30:00' },
  GPS: {
    [piexif.GPSIFD.GPSLatitudeRef]: 'N',
    [piexif.GPSIFD.GPSLatitude]: piexif.GPSHelper.degToDmsRational(lat),
    [piexif.GPSIFD.GPSLongitudeRef]: 'W',
    [piexif.GPSIFD.GPSLongitude]: piexif.GPSHelper.degToDmsRational(lng),
  },
};
const withExif = piexif.insert(piexif.dump(exif), binary);
mkdirSync(dirname(out), { recursive: true });
const bytes = Buffer.from(withExif, 'binary');
writeFileSync(out, bytes);
console.log(`wrote ${out} (${bytes.length} bytes)`);
