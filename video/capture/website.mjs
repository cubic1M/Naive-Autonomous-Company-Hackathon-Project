// 03-website.mp4 — real recording of the web app: home, scroll, click "Get API access", fill the key form, click "Create my key".
import { chromium, newCtx, click, type, smoothScroll, finish, sleep } from './lib.mjs';
const BASE = process.env.WEB || 'http://localhost:3100';

export async function main(browser) {
  const { ctx, vdir } = await newCtx(browser, { name: 'web' });
  // The mock API has no /v1/customers route, so answer it with a response of the real shape (key redacted, never a live key).
  await ctx.route('**/api/v1/customers', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ customer_id: '6d79417a-af85-4642-b5a6-f6966c2d404e', api_key: 'opk_1q7N••••••••', mcp_url: 'https://api.operis.live/mcp' }) }));
  const page = await ctx.newPage();
  await page.goto(BASE + '/'); await page.waitForLoadState('networkidle'); await sleep(1800);
  await smoothScroll(page, 700, 2200); await sleep(1000);
  await smoothScroll(page, 1500, 2200); await sleep(900);
  await smoothScroll(page, 0, 1800); await sleep(800);
  await click(page, page.getByRole('link', { name: 'Get API access' }).first());
  await page.waitForURL('**/developers'); await sleep(1500);
  await smoothScroll(page, 280, 1000); await sleep(500);
  await type(page, page.getByPlaceholder('Acme Autonomous Store'), 'Demo Video Agent');
  await type(page, page.getByPlaceholder('ops@acme.ai'), 'ops@demo-agent.ai');
  await sleep(500);
  await click(page, page.getByRole('button', { name: 'Create my key' }), { after: 1500 });
  await page.getByText('opk_1q7N').first().waitFor();
  await sleep(1200);
  await smoothScroll(page, await page.evaluate(() => scrollY) + 380, 1500); await sleep(2200);
  return finish(ctx, page, vdir, '03-website.mp4');
}
if (import.meta.url === `file://${process.argv[1]}`) { const b = await chromium.launch(); console.log(await main(b)); await b.close(); }
