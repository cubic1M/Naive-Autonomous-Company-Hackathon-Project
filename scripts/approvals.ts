// Founder approvals for Naïve "ask" tools, from the terminal.
//   npm run approvals                                    list what's waiting (real pending check)
//   npm run approvals -- allow <session> <call> [--session]   approve once, or for the rest of the session
//   npm run approvals -- deny  <session> <call> "reason"
//   npm run approvals -- allow-all [--session]           approve everything currently waiting
import "./env";
const NAIVE = "https://api.vetta.sh/v1";
const H = { Authorization: `Bearer ${process.env.NAIVE_API_KEY}`, "Content-Type": "application/json" };
const argv = process.argv.slice(2);
const scope = argv.includes("--session") ? "session" : "call";
const [cmd, session, callId, reason] = argv.filter((a) => a !== "--session");
const get = async (u: string) => { const r = await fetch(u, { headers: H }); const t = (await r.text()).replace(/[\u0000-\u001F]/g, " "); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: {} as any }; } };
const decide = async (s: string, c: string, d: string, why: string) => {
  const r = await fetch(`${NAIVE}/sessions/${s}/tool_confirmations`, { method: "POST", headers: H, body: JSON.stringify({ tool_call_id: c, decision: d, scope, reason: why }) });
  console.log(`${r.ok ? "✓" : "✗"} ${d} (${scope}) ${s} ${c} → ${r.status}`);
};

async function pending() {
  const ids = new Map(["CEO", "OPS", "VERIFIER", "FINANCE", "SALES", "DISPUTES", "COMPLIANCE"].map((r) => [process.env[`NAIVE_AGENT_${r}`], r.toLowerCase()]));
  // waiting = session stopped with stop_reason "awaiting_approval"; its calls are the tool.confirm events since it last ran
  const sessions = ((await get(`${NAIVE}/sessions?limit=30`)).body.data ?? []).filter((s: any) => ids.has(s.agent_id) && s.stop_reason === "awaiting_approval");
  const out: any[] = [];
  for (const s of sessions) {
    let cursor = ""; const events: any[] = [];
    for (let p = 0; p < 10; p++) {
      const ev = (await get(`${NAIVE}/sessions/${s.id}/events?limit=100${cursor ? `&after_seq=${cursor}` : ""}`)).body;
      events.push(...(ev.data ?? []));
      if (!ev.has_more || !ev.next_cursor) break;
      cursor = ev.next_cursor;
    }
    let lastRun = -1; events.forEach((e, i) => { if (e.type === "session.running") lastRun = i; });
    for (const e of events.slice(lastRun + 1).filter((e) => e.type === "tool.confirm"))
      out.push({ session: s.id, agent: ids.get(s.agent_id), tool: e.data?.name, call: e.data?.tool_call_id, args: e.data?.args });
  }
  return out;
}

if (cmd === "allow" || cmd === "deny") await decide(session, callId, cmd, reason ?? `founder ${cmd}`);
else if (cmd === "allow-all") for (const p of await pending()) await decide(p.session, p.call, "allow", "founder allow-all");
else {
  const p = await pending();
  for (const x of p) console.log(`⏳ ${x.agent.padEnd(8)} ${x.tool}\n   npm run approvals -- allow ${x.session} ${x.call} --session\n   args: ${JSON.stringify(x.args ?? {}).slice(0, 200)}`);
  console.log(p.length ? `\n${p.length} waiting.` : "No pending approvals.");
}
