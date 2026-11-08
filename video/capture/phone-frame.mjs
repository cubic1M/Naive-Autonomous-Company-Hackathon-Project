// Builds the 1920x1080 phone-frame PNG (cream background, bezel, transparent screen hole) and composites the phone recording.
import { spawnSync } from 'node:child_process'; import path from 'node:path'; import fs from 'node:fs';
import { tmp, clips, dur } from './lib.mjs';

// [from, to, speed] in raw-video seconds (boring stretches fast-forwarded)
export const RAMPS = (marks) => {
  const m = Object.fromEntries(marks); const off = 0.3; // video starts slightly before the script's t0
  const t = (k) => m[k] + off;
  return [[0, t('job'), 1.4], [t('job'), t('signup'), 1.5], [t('signup'), t('identity'), 3], [t('identity'), t('onboarding'), 2],
    [t('onboarding'), t('accept'), 3.5], [t('accept'), t('proof'), 1.5], [t('proof'), t('submitted'), 2.5], [t('submitted'), t('back'), 1],
    [t('back'), t('payout-link'), 2.5], [t('payout-link'), 999, 1.5]];
};
export function main() {
  const raw = path.join(tmp, 'phone-raw.mp4'); const marks = JSON.parse(fs.readFileSync(path.join(tmp, 'phone-marks.json'), 'utf8'));
  const D = dur(raw); const segs = RAMPS(marks).map(([a, b, s]) => [a, Math.min(b, D), s]).filter(([a, b]) => b > a);
  const parts = segs.map(([a, b, s], i) => `[0:v]trim=${a}:${b},setpts=(PTS-STARTPTS)/${s}[v${i}]`).join(';');
  const fc = `${parts};` + segs.map((_, i) => `[v${i}]`).join('') + `concat=n=${segs.length}:v=1:a=0,format=yuv420p[out]`;
  const out = path.join(clips, '04-worker-phone.mp4');
  const r = spawnSync('ffmpeg', ['-y', '-i', raw, '-filter_complex', fc, '-map', '[out]', '-c:v', 'libx264', '-crf', '18', '-r', '30', '-pix_fmt', 'yuv420p', out], { stdio: 'ignore' });
  if (r.status) throw new Error('ffmpeg phone');
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) console.log(main(), dur(path.join(clips, '04-worker-phone.mp4')));
