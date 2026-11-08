// 04-worker-phone.mp4 — the worker's whole journey on the real pages, phone-sized, with real taps.
// invite email -> job page -> sign up -> identity (simulated Stripe Identity) -> accept -> proof (geolocated photos) -> payout.
import { chromium, devices, CURSOR_JS, click, type, smoothScroll, sleep, tmp, clips, root, dur } from './lib.mjs';
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
import url from 'node:url';
const BASE = process.env.WEB || 'http://localhost:3100';
const dir = path.dirname(url.fileURLToPath(import.meta.url));
const JOB = { lat: 37.7897, lng: -122.4004 }; // the mock job's address (548 Market St); inside the 150 m geofence
export const PHONE = { w: 390, h: 844 };

function inviteHtml() {
  let h = fs.readFileSync(path.join(root, '..', 'docs', 'previews', 'invite-email.html'), 'utf8');
  return h.replace(/https:\/\/operis\.live\/j\/[A-Za-z0-9_-]+/g, BASE + '/j/demo');
}

function hostHtml() {
  const S = { x: 740, y: 64, w: 440, h: 952 }, sc = S.w / PHONE.w;
  return `<!doctype html><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:1920px;height:1080px;overflow:hidden;background:#fbfaf6;font-family:Inter,sans-serif}
.body{position:absolute;left:${S.x - 18}px;top:${S.y - 18}px;width:${S.w + 36}px;height:${S.h + 36}px;border-radius:62px;background:#141a16;box-shadow:12px 22px 50px rgba(31,42,34,.3)}
.scr{position:absolute;left:${S.x}px;top:${S.y}px;width:${S.w}px;height:${S.h}px;border-radius:46px;overflow:hidden;background:#fff}
iframe{width:${PHONE.w}px;height:${PHONE.h}px;border:0;transform:scale(${sc});transform-origin:0 0;display:block}
.k{position:absolute;left:130px;top:380px;font-weight:600;font-size:22px;letter-spacing:3px;color:#46664f}
.h{position:absolute;left:130px;top:420px;font:400 84px/1.1 'Instrument Serif',serif;color:#2f3a33}.h i{color:#46664f}
.p{position:absolute;left:130px;top:650px;font-size:30px;line-height:1.5;color:#4a514c}</style>
<div class="k">THEIR SIDE OF THE SCREEN</div><div class="h">An email, a tap,<br><i>a paid job.</i></div><div class="p">Real pages, real taps.<br>Invite, ID check, proof, payout.</div>
<div class="body"></div><div class="scr"><iframe name="app" src="/__invite"></iframe></div>`;
}
export async function main(browser) {
  const marks = []; const t0 = Date.now();
  const vdir = path.join(tmp, 'phone'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
    recordVideo: { dir: vdir, size: { width: 1920, height: 1080 } },
    geolocation: { latitude: JOB.lat + 0.0003, longitude: JOB.lng + 0.0002, accuracy: 12 }, permissions: ['geolocation'],
  });
  await ctx.addInitScript(CURSOR_JS);
  await ctx.route(BASE + '/__invite', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: inviteHtml() }));
  await ctx.route(BASE + '/__phone', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: hostHtml() }));
  const host = await ctx.newPage();
  await host.goto(BASE + '/__phone'); await host.evaluate(() => document.fonts.ready);
  const page = host.frame('app'); const O = { host };
  const mark = (n) => { marks.push([n, (Date.now() - t0) / 1000]); console.log('mark', n); };

  // 1. the invite email
  await sleep(2200); mark('email');
  await smoothScroll(page, 330, 1400); await sleep(700);
  await click(page, page.getByRole('link', { name: /view job/i }), { ...O, after: 600 });
  // 2. job page (logged out) -> create an account
  await page.waitForURL('**/j/demo'); await page.getByText('Log in to accept').waitFor(); await sleep(1500); mark('job');
  await smoothScroll(page, 500, 1500); await sleep(900); await smoothScroll(page, 0, 900);
  await click(page, page.getByRole('link', { name: /Create an account/ }), O); mark('signup');
  await page.waitForURL('**/signup**'); await sleep(900);
  const f = page.locator('input');
  await type(page, f.nth(0), 'Andrew Park', O); await type(page, f.nth(1), 'andrew@example.com', O);
  await type(page, f.nth(2), '(415) 555-0188', O); await type(page, f.nth(3), 'operis-demo-pass-1', O);
  await click(page, page.getByRole('button', { name: /Create account and continue/ }), { ...O, after: 1200 });
  // 3. identity (Stripe Identity, simulated by the mock)
  await page.getByRole('button', { name: /Start verification/ }).waitFor(); await sleep(900); mark('identity');
  await click(page, page.getByRole('button', { name: /Start verification/ }), O);
  await page.waitForURL('**/mock/stripe-identity**'); await sleep(1500);
  await click(page, page.getByText(/passes/), { ...O, after: 600 });
  await page.waitForURL('**/onboarding**'); await page.getByText('Selfie matched').waitFor({ timeout: 15000 }); await sleep(1200);
  // 4. rest of onboarding
  mark('onboarding');
  await click(page, page.getByRole('button', { name: /^Continue/ }), { ...O, after: 700 });
  await click(page, page.getByRole('button', { name: 'Photo & video' }), { ...O, after: 500 });
  await click(page, page.getByRole('button', { name: /^Continue/ }), { ...O, after: 700 });
  await click(page, page.getByRole('button', { name: /^Continue/ }), { ...O, after: 700 });
  await click(page, page.locator('input[type=checkbox]').last(), { ...O, after: 500 });
  await click(page, page.getByRole('button', { name: /Finish setup/ }), { ...O, after: 1400 });
  await click(page, page.getByRole('link', { name: /Back to your job/ }), O); mark('accept');
  await page.getByRole('button', { name: /Accept job/ }).waitFor(); await sleep(1500);
  await click(page, page.getByRole('button', { name: /Accept job/ }), { ...O, after: 1500 });
  // 5. proof
  mark('proof');
  await click(page, page.getByRole('link', { name: /upload proof/ }), O);
  await page.waitForURL('**/proof'); await sleep(2200);
  for (const t of await page.getByRole('checkbox').all()) await click(page, t, { ...O, after: 400 });
  const [chooser] = await Promise.all([host.waitForEvent('filechooser'), click(page, page.getByRole('button', { name: /Take photos/ }), { ...O, after: 100 })]);
  await chooser.setFiles([path.join(dir, 'assets/proof-facade.jpg'), path.join(dir, 'assets/proof-hours.jpg')]);
  await sleep(1800);
  await click(page, page.getByRole('button', { name: /Submit proof/ }), { ...O, after: 2500 }); mark('submitted');
  await host.screenshot({ path: path.join(tmp, 'after-submit.png') });
  // 6. back to the job; the mock approves ~8 s after the proof, then the payout link shows up
  await click(page, page.getByRole('link', { name: /Back to the job/ }).or(page.getByRole('button', { name: /Back to the job/ })).first(), { ...O, after: 1000 }); mark('back');
  const payout = page.getByRole('link', { name: /Set up payout|Payout details/ }).first();
  await payout.waitFor({ timeout: 40000 }).catch(() => {});
  await host.screenshot({ path: path.join(tmp, 'job-approved.png') }); await sleep(1200); mark('payout-link');
  if (await payout.count()) { await click(page, payout, { ...O, after: 1500 }); await host.screenshot({ path: path.join(tmp, 'payout.png') }); await sleep(1500);
    const connect = page.locator('button.btn').first(); if (await connect.count()) { await click(page, connect, { ...O, after: 2500 }); await host.screenshot({ path: path.join(tmp, 'payout2.png') }); } }
  mark('end'); await sleep(2000);
  const v = host.video(); await ctx.close();
  const webm = await v.path();
  const out = path.join(tmp, 'phone-raw.mp4');
  spawnSync('ffmpeg', ['-y', '-i', webm, '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', '30', '-an', out], { stdio: 'ignore' });
  fs.writeFileSync(path.join(tmp, 'phone-marks.json'), JSON.stringify(marks));
  console.log(marks);
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) { const b = await chromium.launch(); try { console.log(await main(b)); } finally { await b.close(); } }
