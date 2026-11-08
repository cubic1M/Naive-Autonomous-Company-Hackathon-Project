import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const { chromium, devices } = require('playwright');
import { spawnSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
export const dir = path.dirname(url.fileURLToPath(import.meta.url));
export const root = path.resolve(dir, '..');
export const clips = path.join(root, 'clips');
export const tmp = path.join(dir, '.tmp');
fs.mkdirSync(clips, { recursive: true }); fs.mkdirSync(tmp, { recursive: true });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Visible cursor + click ripple, injected into every page. window.__cursorTo(x,y,ms) animates it.
export const CURSOR_JS = `(() => {
  const css = \`
  nextjs-portal,[data-nextjs-toast],[data-nextjs-dev-tools-button],#__next-build-watcher,[data-next-badge-root]{display:none!important}
  #__cur{position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:transform 650ms cubic-bezier(.45,.05,.2,1)}
  #__cur svg{filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))}
  .__rip{position:fixed;z-index:2147483646;pointer-events:none;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:3px solid #46664f;background:rgba(70,102,79,.25);animation:__rip 650ms ease-out forwards}
  @keyframes __rip{to{transform:scale(4.5);opacity:0}}\`;
  const init = () => {
    if (document.getElementById('__cur')) return;
    const s = document.createElement('style'); s.textContent = css; document.documentElement.appendChild(s);
    const c = document.createElement('div'); c.id = '__cur';
    c.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.6L9.6 19z" fill="#19211a" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    let p = window.__curPos; if (!p) { try { p = JSON.parse(sessionStorage.getItem('__cp')); } catch (e) {} } p = p || {x: -100, y: -100}; window.__curPos = p;
    c.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px)';
  };
  window.__cursorTo = (x, y) => { init(); window.__curPos = {x, y}; try { sessionStorage.setItem('__cp', JSON.stringify({x, y})); } catch (e) {} document.getElementById('__cur').style.transform = 'translate(' + x + 'px,' + y + 'px)'; };
  window.__ripple = (x, y) => { init(); const r = document.createElement('div'); r.className = '__rip'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 800); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  setInterval(init, 300);
})();`;

export async function newCtx(browser, { w = 1920, h = 1080, name, phone = false, extra = {} } = {}) {
  const vdir = path.join(tmp, name); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const base = phone ? { ...devices['iPhone 14'] } : { viewport: { width: w, height: h }, deviceScaleFactor: 1 };
  const vp = phone ? base.viewport : { width: w, height: h };
  const ctx = await browser.newContext({ ...base, ...(phone ? { deviceScaleFactor: 1 } : {}), recordVideo: { dir: vdir, size: vp }, ...extra });
  await ctx.addInitScript(CURSOR_JS);
  return { ctx, vdir };
}

// Move the visible cursor to the element's center, pause, ripple, then really click it.
export async function click(page, target, { pause = 350, after = 900, host = page } = {}) {
  const loc = typeof target === 'string' ? page.locator(target).first() : target;
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await host.evaluate(([x, y]) => window.__cursorTo(x, y), [x, y]);
  await sleep(750 + pause);
  await host.evaluate(([x, y]) => window.__ripple(x, y), [x, y]);
  await loc.click();
  await sleep(after);
}
export async function type(page, target, text, { delay = 35, host = page } = {}) {
  const loc = typeof target === 'string' ? page.locator(target).first() : target;
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  const x = b.x + Math.min(b.width / 2, 120), y = b.y + b.height / 2;
  await host.evaluate(([x, y]) => window.__cursorTo(x, y), [x, y]);
  await sleep(750);
  await host.evaluate(([x, y]) => window.__ripple(x, y), [x, y]);
  await loc.click();
  await (host.page ? host.page() : host).keyboard.type(text, { delay });
  await sleep(400);
}
export async function smoothScroll(page, to, ms = 2000) {
  await page.evaluate(([to, ms]) => new Promise((res) => {
    const from = window.scrollY, t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; window.scrollTo(0, from + (to - from) * e); k < 1 ? requestAnimationFrame(step) : res(); };
    requestAnimationFrame(step);
  }), [to, ms]);
}

// Close context, take the single webm, transcode to mp4 (30fps h264).
export async function finish(ctx, page, vdir, outName, ffExtra = []) {
  const v = page.video(); await ctx.close();
  const webm = await v.path();
  const out = path.join(clips, outName);
  const r = spawnSync('ffmpeg', ['-y', '-i', webm, ...ffExtra, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-an', out], { stdio: 'ignore' });
  if (r.status) throw new Error('ffmpeg failed ' + outName);
  return out;
}
export const dur = (f) => +spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).stdout.toString();
