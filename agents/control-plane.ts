// Give the CEO Naïve's own control plane (api.vetta.sh/v1/mcp), least privilege, so it can see the whole company in
// Naïve (agents, sessions, spend, schedules, balance, audit log) and, with a founder's yes, run or pause schedules and
// start a teammate's session. Per Naïve's docs, binding /v1/mcp to an agent in the "Orchestrator control plane" vault
// records it as the organization's ceo_agent_id.
//
//   npx tsx agents/control-plane.ts            dry run: prints what it would create
//   npx tsx agents/control-plane.ts --apply    mints the MCP session (90 days), stores it in the vault, then
//   CEO_CONTROL_PLANE=true API_BASE_URL=https://api.operis.live npm run agents:setup   adds the server to the CEO
//
// Revoke any time: DELETE /v1/mcp_sessions/{id} (printed below), or delete the vault credential.
import { readFileSync, existsSync } from "node:fs";

const env = existsSync("apps/api/.env.local") ? readFileSync("apps/api/.env.local", "utf8") : "";
const KEY = process.env.NAIVE_API_KEY ?? env.match(/^NAIVE_API_KEY=(.*)$/m)?.[1]?.replace(/"/g, "");
const NAIVE = "https://api.vetta.sh/v1";
const CONTROL_PLANE_URL = `${NAIVE}/mcp`;
const VAULT = "Orchestrator control plane";
const APPLY = process.argv.includes("--apply");
if (!KEY) throw new Error("NAIVE_API_KEY not set");

// Tool → permission. Kept in sync with agents.json ceo.control_plane.tools (setup.ts reads that file).
const cfg = JSON.parse(readFileSync("agents/agents.json", "utf8"));
const tools: Record<string, string> = cfg.ceo.control_plane.tools;
const allowed_tools = Object.keys(tools);
// Only the scopes these tools need. agents:write covers schedule pause/resume/run; allowed_tools keeps it from
// reaching agents_patch / agents_delete (those tools are not in the list).
const scopes = ["agents:read", "agents:write", "sessions:read", "sessions:write", "billing:read", "audit:read"];

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(`${NAIVE}${path}`, {
    method, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

console.log(`Control plane for the CEO: ${CONTROL_PLANE_URL}`);
console.log(`scopes: ${scopes.join(", ")}`);
for (const [t, p] of Object.entries(tools)) console.log(`  ${p.padEnd(5)} ${t}`);
if (!APPLY) { console.log("\nDry run. Re-run with --apply to mint the session and store it in the vault."); process.exit(0); }

const session = await api("POST", "/mcp_sessions", {
  name: "operis-ceo control plane", scopes, allowed_tools, expires_in_seconds: 90 * 24 * 3600,
});
console.log(`✓ MCP session ${session.id} (${session.prefix}…), expires ${session.expires_at}`);

const vaults = (await api("GET", "/vaults?limit=100")).data ?? [];
const vault = vaults.find((v: any) => v.display_name === VAULT) ?? (await api("POST", "/vaults", { display_name: VAULT }));
const creds = (await api("GET", `/vaults/${vault.id}/credentials`)).data ?? [];
for (const c of creds) if (c.key === "naive-control-plane") await api("DELETE", `/vaults/${vault.id}/credentials/${c.id}`);
await api("POST", `/vaults/${vault.id}/credentials`, { kind: "static_bearer", key: "naive-control-plane", mcp_server_url: CONTROL_PLANE_URL, value: session.secret });
console.log(`✓ vault "${VAULT}" (${vault.id}): static_bearer for ${CONTROL_PLANE_URL}`);
console.log(`\nNext: CEO_CONTROL_PLANE=true API_BASE_URL=https://api.operis.live npm run agents:setup`);
console.log(`Revoke: DELETE ${NAIVE}/mcp_sessions/${session.id}`);
