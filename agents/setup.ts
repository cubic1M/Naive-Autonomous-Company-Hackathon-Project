// Create or update the Operis team on Naïve from agents/agents.json. Safe to re-run.
//
//   npm run agents:setup                       # uses API_BASE_URL from apps/api/.env.local
//   npm run agents:setup -- --auth=query       # MCP auth fallback: ?key= on the URL instead of the vault
//   npm run agents:setup -- --write-env        # write NAIVE_AGENT_* ids into apps/api/.env.local
//
// Auth modes for our internal MCP server:
//   vault  (default) static_bearer credential bound to our host, injected by Naïve
//   header           Authorization header on the mcp_servers entry
//   query            ?key=<INTERNAL_MCP_KEY> on the URL
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../scripts/env";

const NAIVE = "https://api.vetta.sh/v1";
const KEY = process.env.NAIVE_API_KEY!;
const INTERNAL = process.env.INTERNAL_MCP_KEY!;
const BASE = (process.env.API_BASE_URL ?? "").replace(/\/$/, "");
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? "true"]));
const AUTH = (args.auth ?? "vault") as "vault" | "header" | "query";
if (!KEY || !INTERNAL || !BASE.startsWith("https://")) {
  console.error("Need NAIVE_API_KEY, INTERNAL_MCP_KEY and an https API_BASE_URL in apps/api/.env.local");
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(path.join(ROOT, "agents/agents.json"), "utf8"));
const shared = readFileSync(path.join(ROOT, "agents/prompts/_shared.md"), "utf8");
const prompt = (role: string) => `${readFileSync(path.join(ROOT, `agents/prompts/${role}.md`), "utf8")}\n\n${shared}`;

async function api(method: string, p: string, body?: unknown) {
  const res = await fetch(`${NAIVE}${p}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${JSON.stringify(json).slice(0, 500)}`);
  return json;
}
async function listAll(p: string) {
  const out: any[] = [];
  let after = "";
  for (let i = 0; i < 20; i++) {
    const r = await api("GET", `${p}?limit=100${after ? `&after=${after}` : ""}`);
    out.push(...(r.data ?? []));
    if (!r.has_more || !r.data?.length) break;
    after = r.data[r.data.length - 1].id;
  }
  return out;
}

const mcpUrl = `${BASE}/mcp/internal${AUTH === "query" ? `?key=${encodeURIComponent(INTERNAL)}` : ""}`;
const mcpServer: any = { name: cfg.mcp_server_name, url: mcpUrl };
if (AUTH === "header") mcpServer.headers = { Authorization: `Bearer ${INTERNAL}` };

const toolsConfig = (tools: Record<string, string>) => ({
  default_config: { permission: "deny" },
  configs: Object.fromEntries(Object.entries(tools).map(([t, perm]) => [t, { enabled: true, permission: perm }])),
});
const budget = (b: { cap: number; max_task: number }) => ({ cap_micro_usd: b.cap * 1e6, max_task_micro_usd: b.max_task * 1e6, period: "day" });

const existing = await listAll("/agents");
async function upsert(spec: any, body: any) {
  const found = existing.find((a) => a.name === spec.name);
  if (!found) {
    const a = await api("POST", "/agents", body);
    console.log(`+ created ${spec.name} ${a.id} v${a.current_version ?? 1}`);
    return a;
  }
  const cur = await api("GET", `/agents/${found.id}`);
  const a = await api("PATCH", `/agents/${found.id}`, { ...body, expected_version: cur.current_version });
  console.log(`~ updated ${spec.name} ${a.id} v${a.current_version}`);
  return a;
}

// 1. vault credential (auth mode "vault")
if (AUTH === "vault") {
  const host = new URL(BASE).host;
  const vaults = await listAll("/vaults");
  const vault = vaults.find((v) => v.display_name === "operis") ?? (await api("POST", "/vaults", { display_name: "operis" }));
  const creds = (await api("GET", `/vaults/${vault.id}/credentials`)).data ?? [];
  for (const c of creds) if (c.key === "operis-internal") await api("DELETE", `/vaults/${vault.id}/credentials/${c.id}`);
  await api("POST", `/vaults/${vault.id}/credentials`, { kind: "static_bearer", key: "operis-internal", host, value: INTERNAL });
  console.log(`✓ vault ${vault.id}: static_bearer for ${host}`);
}

// 2. members
const ids: Record<string, string> = {};
const versions: Record<string, number> = {};
for (const [role, m] of Object.entries<any>(cfg.members)) {
  const body: any = {
    name: m.name, description: m.description, model: cfg.model, harness: cfg.harness,
    system: prompt(role), mcp_servers: [mcpServer], tools: toolsConfig(m.tools), budget: budget(m.budget_usd),
  };
  if (m.output_schema) Object.assign(body, { output_schema: m.output_schema, structured_output_required: true });
  if (m.skills) body.skills = m.skills;
  const a = await upsert(m, body);
  ids[role] = a.id;
  versions[role] = a.current_version ?? 1;
}

// 3. CEO coordinator, members pinned to their current versions
const c = cfg.ceo;
const ceoBody: any = {
  name: c.name, description: c.description, model: cfg.model, harness: cfg.harness,
  system: prompt("ceo"), mcp_servers: [mcpServer], tools: toolsConfig(c.tools), budget: budget(c.budget_usd),
  multiagent: { type: "coordinator", board: true, agents: Object.keys(cfg.members).map((r) => ({ type: "agent", id: ids[r], version: versions[r] })) },
};
if (process.env.FOUNDER_EMAIL) ceoBody.notifications = { email: process.env.FOUNDER_EMAIL, approvals: true, questions: true, updates: false };
const ceo = await upsert(c, ceoBody);
ids.ceo = ceo.id;

// 4. webhook → our API (agent feed, approvals, budget alerts)
if (process.env.NAIVE_WEBHOOK_SECRET && !args["skip-webhook"]) {
  const url = `${BASE}/webhooks/naive?k=${encodeURIComponent(process.env.NAIVE_WEBHOOK_SECRET)}`;
  const hooks = await listAll("/webhooks");
  for (const h of hooks) if (typeof h.url === "string" && h.url.includes("/webhooks/naive") && h.url !== url) await api("DELETE", `/webhooks/${h.id}`);
  if (!hooks.some((h) => h.url === url)) {
    await api("POST", "/webhooks", { url, events: ["session.idle", "tool.started", "tool.completed", "tool.confirm", "budget.exceeded", "handoff.sent"] });
    console.log(`✓ webhook → ${BASE}/webhooks/naive`);
  }
}

// 5. daily report on the CEO
if (c.daily_report && !args["skip-cron"]) {
  const deps = await listAll("/deployments");
  if (!deps.some((d) => d.agent_id === ceo.id)) {
    await api("POST", "/deployments", {
      agent_id: ceo.id, cron: c.daily_report.cron, timezone: c.daily_report.timezone,
      input_template: "Write today's daily report for the founders: call operis.ledger, summarize jobs paid, revenue, fees, payouts, anything escalated or stuck, and one recommendation.",
      budget_micro_usd: c.daily_report.budget_usd * 1e6,
    });
    console.log(`✓ daily report cron ${c.daily_report.cron} ${c.daily_report.timezone}`);
  }
}

// 6. member schedules (e.g. Ops re-blast), created once per agent+cron
{
  const deps = await listAll("/deployments");
  for (const [role, m] of Object.entries<any>(cfg.members)) {
    for (const sch of m.schedules ?? []) {
      if (deps.some((d) => d.agent_id === ids[role] && d.cron === sch.cron)) continue;
      await api("POST", "/deployments", {
        agent_id: ids[role], cron: sch.cron, timezone: sch.timezone, input_template: sch.input,
        budget_micro_usd: sch.budget_usd * 1e6, enabled: sch.enabled ?? true,
      });
      console.log(`✓ ${m.name} schedule ${sch.cron}${sch.enabled === false ? " (disabled)" : ""}`);
    }
  }
}

const envLines = Object.entries(ids).map(([r, id]) => `NAIVE_AGENT_${r.toUpperCase()}=${id}`);
console.log(`\nMCP auth mode: ${AUTH}\n${envLines.join("\n")}`);
if (args["write-env"]) {
  const p = path.join(ROOT, "apps/api/.env.local");
  let s = readFileSync(p, "utf8");
  for (const line of envLines) {
    const k = line.split("=")[0];
    s = new RegExp(`^${k}=.*$`, "m").test(s) ? s.replace(new RegExp(`^${k}=.*$`, "m"), line) : s + `\n${line}`;
  }
  writeFileSync(p, s);
  console.log("→ wrote ids to apps/api/.env.local (restart the API to pick them up)");
}
