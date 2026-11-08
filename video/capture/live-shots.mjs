// Refreshes assets/real/site-*.png from the LIVE site, so the animated scenes show the current product.
import { chromium, root, sleep } from './lib.mjs';
import path from 'node:path';
const LIVE = process.env.LIVE || 'https://operis.live';
export async function main(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const out = [];
  for (const [n, u] of [['site-home', '/'], ['site-developers', '/developers'], ['site-jobs', '/jobs']]) {
    await p.goto(LIVE + u, { waitUntil: 'networkidle' }); await sleep(2500);
    const f = path.join(root, 'assets', 'real', n + '.png'); await p.screenshot({ path: f }); out.push(f);
  }
  await ctx.close(); return out;
}
if (import.meta.url === `file://${process.argv[1]}`) { const b = await chromium.launch(); console.log(await main(b)); await b.close(); }
