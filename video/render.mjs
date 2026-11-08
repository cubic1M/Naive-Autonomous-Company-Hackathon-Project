// Usage: node render.mjs [--stills] [--from S --to S] [--fps N] [--workers N]
import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright');
import { spawnSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const dir = path.dirname(url.fileURLToPath(import.meta.url));
const a = process.argv.slice(2), arg = (k, d) => { const i = a.indexOf(k); return i < 0 ? d : a[i + 1]; };
const stills = a.includes('--stills'), fps = +arg('--fps', 30), workers = +arg('--workers', 4);
const B = [0, 6.5, 13.5, 20.5, 28.5, 34.5, 39, 49.5, 56.5, 60];
const page0 = 'file://' + path.join(dir, 'index.html') + '?render=1';
const browser = await chromium.launch();
async function open() {
  const p = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
  await p.goto(page0); await p.evaluate(() => document.fonts.ready); await p.waitForFunction('window.__ready===true');
  await p.waitForTimeout(500); return p;
}
if (stills) {
  fs.mkdirSync(path.join(dir, 'stills'), { recursive: true });
  const p = await open();
  for (let i = 0; i < 9; i++) {
    const t = B[i] + (B[i + 1] - B[i]) * (i === 8 ? 0.95 : 0.88);
    await p.evaluate(t => window.seek(t), t);
    await p.screenshot({ path: path.join(dir, 'stills', `scene${i + 1}.png`) });
    console.log('still', i + 1, t.toFixed(1));
  }
  await browser.close(); process.exit(0);
}
const from = +arg('--from', 0), to = +arg("--to", 60);
const fdir = path.join(dir, 'frames'); fs.rmSync(fdir, { recursive: true, force: true }); fs.mkdirSync(fdir);
const f0 = Math.round(from * fps), f1 = Math.round(to * fps);
const pages = await Promise.all(Array.from({ length: workers }, open));
let next = f0;
await Promise.all(pages.map(async p => { for (;;) { const i = next++; if (i >= f1) return;
  await p.evaluate(t => window.seek(t), i / fps);
  await p.screenshot({ path: path.join(fdir, String(i - f0).padStart(5, '0') + '.png') });
  if (i % 100 === 0) console.log('frame', i, '/', f1); } }));
await browser.close();
const out = path.join(dir, 'operis-story.mp4');
const r = spawnSync('ffmpeg', ['-y', '-framerate', String(fps), '-i', path.join(fdir, '%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', out], { stdio: 'inherit' });
process.exit(r.status ?? 0);
