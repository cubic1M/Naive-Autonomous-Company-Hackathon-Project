// Renders a realistic dark macOS-style terminal in a page, types commands (~35 ms/char), prints outputs,
// and records it with Playwright. `steps`: [{ cmd: "text (\n = continuation)", out: [html lines], hold: ms, clear: bool }]
import { chromium, newCtx, finish, sleep } from './lib.mjs';

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// JSON syntax highlight on already-formatted JSON text
export function hlJson(text) {
  return esc(text)
    .replace(/("(?:[^"\\]|\\.)*")(\s*:)/g, '<span class="k">$1</span>$2')
    .replace(/: ("(?:[^"\\]|\\.)*")/g, ': <span class="s">$1</span>')
    .replace(/([\[,]\s*)("(?:[^"\\]|\\.)*")(?=\s*[,\]])/g, '$1<span class="s">$2</span>')
    .replace(/: (-?\d+(?:\.\d+)?)/g, ': <span class="n">$1</span>')
    .replace(/\b(true|false|null)\b(?![^<]*>)/g, '<span class="b">$1</span>');
}
export function hlCmd(text) {
  return esc(text)
    .replace(/^(\s*)(curl|npx|cd)\b/, '$1<span class="cmd">$2</span>')
    .replace(/(\s)(-[XHd])(?=\s)/g, '$1<span class="flag">$2</span>')
    .replace(/(https?:\/\/[^\s'"]+)/g, '<span class="url">$1</span>');
}

const PAGE = (title) => `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;height:1080px;overflow:hidden;background:#fbfaf6;font-family:Inter,system-ui,sans-serif}
body{background:radial-gradient(ellipse at 50% 20%,#eef0e6 0%,#fbfaf6 70%);display:flex;align-items:center;justify-content:center}
#win{width:1640px;height:900px;border-radius:16px;background:#141a16;box-shadow:0 40px 90px rgba(31,42,34,.35),0 0 0 1px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden}
#bar{height:54px;background:linear-gradient(#2b332d,#232a25);display:flex;align-items:center;padding:0 22px;position:relative;flex:none;border-bottom:1px solid #0d110e}
#bar i{width:16px;height:16px;border-radius:50%;margin-right:10px;display:block}
#bar b{position:absolute;left:0;right:0;text-align:center;color:#a8b3aa;font-weight:500;font-size:17px;pointer-events:none}
#t{flex:1;padding:30px 40px;font:500 21px/1.5 'JetBrains Mono',ui-monospace,monospace;color:#d8e2da;display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden;white-space:pre-wrap;word-break:break-word}
.p{color:#9dc3a4}.cmd{color:#f4d9a0}.flag{color:#8fb7d9}.url{color:#9dc3a4}
.k{color:#8fb7d9}.s{color:#b9e0a8}.n{color:#f4d9a0}.b{color:#d7a3d9}.dim{color:#7d8a80}.hi{color:#f4d9a0}.ok{color:#9dc3a4}
.cur{display:inline-block;width:.6em;height:1.15em;background:#9dc3a4;vertical-align:text-bottom;animation:bl 1s steps(1) infinite}
@keyframes bl{50%{opacity:0}}
.ln{min-height:1.5em;flex:none}
</style><body><div id="win"><div id="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><b>${esc(title)}</b></div><div id="t"></div></div>
<script>
const T=document.getElementById('t'),sl=ms=>new Promise(r=>setTimeout(r,ms));
function line(html){const d=document.createElement('div');d.className='ln';d.innerHTML=html;T.appendChild(d);return d}
window.run=async(steps,delay)=>{
  await sl(900);
  for(const st of steps){
    if(st.clear){T.innerHTML=''}
    const rows=st.cmd.split('\\n');let i=0;
    for(const r of rows){
      const d=line('<span class="p">~ $ </span><span class="tx"></span><span class="cur"></span>'.replace('~ $ ',i?'    ':'~ $ '));
      const tx=d.querySelector('.tx');let acc='';
      for(const ch of r){acc+=ch;tx.innerHTML=window.hlCmd(acc);await sl(delay)}
      if(i<rows.length-1){tx.innerHTML=window.hlCmd(acc);d.querySelector('.cur').remove()}
      i++;
    }
    await sl(500);T.lastChild.querySelector('.cur')?.remove();
    for(const o of st.out){line(o);await sl(st.stagger??70)}
    await sl(st.hold??1500);
  }
  line('<span class="p">~ $ </span><span class="cur"></span>');
  await sl(1200);window.__done=true;
};
</script>`;

export async function recordTerminal(browser, name, outFile, title, steps, delay = 35) {
  const { ctx, vdir } = await newCtx(browser, { name });
  const page = await ctx.newPage();
  await page.setContent(PAGE(title));
  await page.evaluate(`window.hlCmd=${hlCmd.toString()};window.esc=${esc.toString()};`);
  await page.evaluate(([s, d]) => { window.run(s, d); }, [steps, delay]);
  await page.waitForFunction('window.__done===true', null, { timeout: 180000 });
  return finish(ctx, page, vdir, outFile);
}
