// Founder approvals for Naïve "ask" tools (e.g. Ops' send_blast, Finance's refund).
//   npm run approvals                       list pending approvals across recent Operis sessions
//   npm run approvals -- allow <session> <tool_call_id>
//   npm run approvals -- deny  <session> <tool_call_id> "reason"
import "./env";
const NAIVE = "https://api.vetta.sh/v1";
const H = { Authorization: `Bearer ${process.env.NAIVE_API_KEY}`, "Content-Type": "application/json" };
const [cmd, session, callId, reason] = process.argv.slice(2);

if (cmd === "allow" || cmd === "deny") {
  const r = await fetch(`${NAIVE}/sessions/${session}/tool_confirmations`, {
    method: "POST", headers: H, body: JSON.stringify({ tool_call_id: callId, decision: cmd, reason: reason ?? `founder ${cmd}` }),
  });
  console.log(r.status, (await r.text()).slice(0, 300));
  process.exit(0);
}

const agentIds = new Set(["CEO", "OPS", "VERIFIER", "FINANCE", "SALES"].map((r) => process.env[`NAIVE_AGENT_${r}`]).filter(Boolean));
const sessions = (await (await fetch(`${NAIVE}/sessions?limit=50`, { headers: H })).json()).data ?? [];
let pending = 0;
for (const s of sessions.filter((s: any) => agentIds.has(s.agent_id))) {
  const ev = (await (await fetch(`${NAIVE}/sessions/${s.id}/events?limit=100`, { headers: H })).json()).data ?? [];
  const resolved = new Set(ev.filter((e: any) => e.type.startsWith("tool.confirm.")).map((e: any) => e.data?.tool_call_id));
  for (const e of ev.filter((e: any) => e.type === "tool.confirm" && !resolved.has(e.data?.tool_call_id))) {
    pending++;
    console.log(`⏳ ${s.id}  ${e.data?.name ?? e.data?.tool?.name}  call=${e.data?.tool_call_id}\n   input: ${JSON.stringify(e.data?.args ?? e.data?.input ?? {}).slice(0, 300)}`);
  }
}
console.log(pending ? `\n${pending} pending. Approve: npm run approvals -- allow <session> <call>` : "No pending approvals.");
