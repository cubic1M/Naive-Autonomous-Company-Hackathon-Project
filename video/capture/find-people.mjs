// 02-find-people.mp4 — runs services/outreach/scripts/pool-search.ts for real and shows its output (names are initials already).
import { chromium, root } from './lib.mjs';
import { recordTerminal, hlJson, esc } from './termlib.mjs';
import { spawnSync } from 'node:child_process'; import path from 'node:path';

export async function main(browser) {
  const r = spawnSync('npx', ['tsx', 'scripts/pool-search.ts'], { cwd: path.resolve(root, '..', 'services', 'outreach'), encoding: 'utf8' });
  if (r.status) throw new Error('pool-search failed: ' + r.stderr);
  const objs = r.stdout.trim().split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  const out = [];
  for (const o of objs) {
    if (o.pool_total !== undefined) {
      out.push(...hlJson(JSON.stringify(o, null, 2)).split('\n'), '');
    } else {
      const { top, ...rest } = o;
      out.push(`<span class="ok">▸</span> <span class="hi">${esc(o.title)}</span>: <span class="n">${o.returned}</span> matches in <span class="n">${o.elapsed_ms}</span> ms`);
      const head = hlJson(JSON.stringify(rest, null, 2)).split('\n');
      out.push(...head.slice(0, -1).map((l, i) => (i > 0 && !l.endsWith(',') ? l + ',' : l)), '  <span class="k">"top"</span>: [');
      top.forEach((t, i) => out.push('    ' + hlJson(JSON.stringify(t).replace(/":/g, '": ').replace(/,"/g, ', "')) + (i < top.length - 1 ? ',' : '')));
      out.push('  ]', '}', '');
    }
  }
  const steps = [{ cmd: 'cd services/outreach && npx tsx scripts/pool-search.ts', out, stagger: 110, hold: 3500 }];
  return recordTerminal(browser, 'term2', '02-find-people.mp4', 'operis · ops agent: find people', steps);
}
if (import.meta.url === `file://${process.argv[1]}`) { const b = await chromium.launch(); console.log(await main(b)); await b.close(); }
