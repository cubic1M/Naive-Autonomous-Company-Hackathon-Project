// Records every clip for real and assembles video/operis-demo.mp4.
// Needs: web app on :3100 (run from apps/web:  API_URL=http://localhost:3001 NEXT_PUBLIC_WORKER_LOGIN=required npx next dev -p 3100)
//        mock API on :3001 (node scripts/mock-api.mjs) — restarted here, because its state is in memory.
// Usage: node video/capture/record-all.mjs [terminal|find|website|worker|dashboard|cards|assemble ...]
import { chromium, root } from './lib.mjs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import * as terminal from './terminal.mjs'; import * as find from './find-people.mjs'; import * as website from './website.mjs';
import * as worker from './worker.mjs'; import * as phone from './phone-frame.mjs'; import * as dashboard from './dashboard.mjs'; import * as cards from './cards.mjs';

const want = process.argv.slice(2); const on = (k) => !want.length || want.includes(k);
const webDir = path.resolve(root, '..', 'apps', 'web');
async function freshMock() {
  spawnSync('pkill', ['-f', 'scripts/mock-api.mjs']); await new Promise((r) => setTimeout(r, 600));
  spawn('node', ['scripts/mock-api.mjs'], { cwd: webDir, detached: true, stdio: 'ignore' }).unref();
  await new Promise((r) => setTimeout(r, 1200));
}
const browser = await chromium.launch();
try {
  if (on('terminal')) console.log(await terminal.main(browser));
  if (on('find')) console.log(await find.main(browser));
  if (on('website')) console.log(await website.main(browser));
  if (on('worker')) { await freshMock(); await worker.main(browser); console.log(phone.main()); }
  if (on('dashboard')) { await freshMock(); console.log(await dashboard.main(browser)); }
  if (on('cards')) console.log(await cards.main(browser));
} finally { await browser.close(); }
if (on('assemble')) spawnSync(path.join(root, 'capture', 'assemble.sh'), { stdio: 'inherit' });
