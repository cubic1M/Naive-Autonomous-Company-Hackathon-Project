// 00-title.mp4 and 99-end.mp4 — title cards in the look of the explainer (cream / forest green, serif).
import { chromium, newCtx, finish, sleep } from './lib.mjs';
const HEAD = `<!doctype html><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:1920px;height:1080px;overflow:hidden;font-family:Inter,sans-serif}
.serif{font-family:'Instrument Serif',Georgia,serif;font-weight:400}.a{position:absolute;left:0;width:1920px;text-align:center;opacity:0}
.g{color:#46664f;font-style:italic}
@keyframes in{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}@keyframes out{to{opacity:0}}</style>`;
const TITLE = HEAD + `<body style="background:#fbfaf6;color:#2f3a33">
<div class="a serif" style="top:330px;font-size:140px;animation:in .8s .2s forwards,out .4s 2.0s forwards">Agents can't show up.</div>
<div class="a serif g" style="top:520px;font-size:140px;animation:in .8s .9s forwards,out .4s 2.0s forwards">People can.</div>
<div class="a serif" style="top:340px;font-size:230px;animation:in .7s 2.3s forwards">operis<span style="color:#46664f">.</span></div>
<div class="a" style="top:650px;font-size:40px;color:#4a514c;animation:in .7s 2.7s forwards">Humans on demand for autonomous companies</div>`;
const END = HEAD + `<body style="background:linear-gradient(135deg,#6a8a71 0%,#4f6f57 40%,#2a4433 100%);color:#fff">
<div class="a serif" style="top:330px;font-size:132px;animation:in .8s .2s forwards">Request <span style="font-style:italic;color:#d6e2ce">→</span> paid human.</div>
<div class="a serif" style="top:560px;font-size:84px;animation:in .8s .7s forwards">operis<span style="color:#cfe3cf">.</span></div>
<div class="a" style="top:720px;font-size:34px;letter-spacing:1px;color:#e4ecdf;animation:in .7s 1.2s forwards"><b style="font-weight:600">operis.live/mcp</b> &nbsp;·&nbsp; Built on Naïve</div>`;
async function card(browser, name, html, out, ms) {
  const { ctx, vdir } = await newCtx(browser, { name });
  const page = await ctx.newPage(); await page.setContent(html); await page.evaluate(() => document.fonts.ready);
  await page.reload().catch(() => {}); // restart animations after fonts are cached
  await page.setContent(html); await page.evaluate(() => document.fonts.ready); await sleep(ms);
  return finish(ctx, page, vdir, out);
}
export async function main(browser) {
  return [await card(browser, 'c0', TITLE, '00-title.mp4', 4200), await card(browser, 'c9', END, '99-end.mp4', 3400)];
}
if (import.meta.url === `file://${process.argv[1]}`) { const b = await chromium.launch(); console.log(await main(b)); await b.close(); }
