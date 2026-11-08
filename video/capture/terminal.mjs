// 01-terminal-mcp.mp4 — real outputs: /v1/customers (key redacted), MCP tools/list, request_human (terminal-request.json).
// Usage: node video/capture/terminal.mjs   (regenerates after terminal-request.json is edited)
import { chromium, root, clips } from './lib.mjs';
import { recordTerminal, hlJson, esc } from './termlib.mjs';
import fs from 'node:fs'; import path from 'node:path';

const SCRATCH = process.env.SCRATCH || '/tmp/claude-0/-home-user-Naive-Autonomous-Company-Hackathon-Project/e09a11b5-0968-5af1-8dfb-f1cea95fe518/scratchpad';
const readJson = (f) => { let t = fs.readFileSync(f, 'utf8').trim(); if (t.includes('data:')) t = t.split('\n').find((l) => l.startsWith('data:')).slice(5); return JSON.parse(t); };
const lines = (obj) => hlJson(JSON.stringify(obj, null, 2)).split('\n');

export async function main(browser) {
  // a) real /v1/customers response, key always redacted
  const cust = readJson(path.join(SCRATCH, 'cust.json'));
  const custOut = { customer_id: cust.customer_id, api_key: cust.api_key.slice(0, 8) + '••••••••', mcp_url: cust.mcp_url };
  // b) real MCP tools/list
  const tools = readJson(path.join(SCRATCH, 'tools.txt')).result.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: '{…}' }));
  const toolsText = JSON.stringify({ result: { tools } }, null, 2).replace(/"\{…\}"/g, '{…}');
  // c) request_human (placeholder response lives in terminal-request.json)
  const req = JSON.parse(fs.readFileSync(path.join(root, 'clips', 'terminal-request.json'), 'utf8'));
  const shown = Object.fromEntries(['title', 'instructions', 'remote', 'budget_usd'].map((k) => [k, req.call[k]]));
  const call = 'request_human(' + JSON.stringify(shown, null, 2).replace(/"(\w+)":/g, '$1:').replace(/\n}$/, ',\n  …\n}') + ')';

  const steps = [
    { cmd: `curl -X POST https://api.operis.live/v1/customers \\\n  -d '{"name":"Demo Video Agent","contact_email":"ops@demo-agent.ai"}'`,
      out: [...hlJson(JSON.stringify(custOut)).split('\n'), '', '<span class="dim"># key shown once, redacted here · save it, it cannot be shown again</span>'], hold: 2200 },
    { clear: true, cmd: `curl https://api.operis.live/mcp \\\n  -H "Authorization: Bearer $OPERIS_KEY" -H "Accept: application/json, text/event-stream" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
      out: hlJson(toolsText).split('\n'), stagger: 45, hold: 3200 },
    { clear: true, cmd: call, out: ['', ...lines(req.response)], hold: 3200 },
  ];
  return recordTerminal(browser, 'term1', '01-terminal-mcp.mp4', 'Demo Video Agent: operis MCP', steps);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const b = await chromium.launch(); console.log(await main(b)); await b.close();
}
