// 05-dashboard.mp4 — the live dashboard while a (mock) worker really accepts and submits proof through the API,
// so the job timeline and agent feed move on their own. Needs a freshly restarted mock API (state is in memory).
import { chromium, newCtx, smoothScroll, finish, sleep } from './lib.mjs';
const BASE = process.env.WEB || 'http://localhost:3100';
const API = process.env.API || 'http://localhost:3001';

async function worker() {
  const login = await fetch(API + '/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'demo@operis.live', password: 'operis-demo-1' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const post = (p, b) => fetch(API + p, { method: 'POST', headers: { cookie }, body: JSON.stringify(b ?? {}) }).then((r) => r.status);
  await sleep(6000);
  console.log('accept', await post('/v1/worker/jobs/demo/accept'));
  await sleep(6500);
  const px = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  console.log('proof', await post('/v1/worker/jobs/demo/proof', { media: [{ kind: 'photo', name: 'facade.jpg', role: 'facade', url: px }], gps_lat: 37.7897, gps_lng: -122.4004, captured_at: new Date().toISOString(), fields: {} }));
}

export async function main(browser) {
  const { ctx, vdir } = await newCtx(browser, { name: 'dash' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/dashboard'); await page.waitForLoadState('networkidle'); await sleep(2500);
  const w = worker();
  await page.mouse.move(960, 540);
  await smoothScroll(page, 420, 3000); await sleep(2200);
  await smoothScroll(page, 0, 2000); await sleep(3000);
  await smoothScroll(page, 500, 3000); await sleep(3500);
  await w; await sleep(9500);               // mock approves ~8 s after the proof
  await smoothScroll(page, 0, 2200); await sleep(3500);
  return finish(ctx, page, vdir, '05-dashboard.mp4');
}
if (import.meta.url === `file://${process.argv[1]}`) { const b = await chromium.launch(); console.log(await main(b)); await b.close(); }
