// Naïve "ask" approvals for our agents. Naïve pauses calls flagged read_people (find_people, board_write
// with an assignee, approve_proof, payout...) for a human even when the tool is set to allow.
// Pending = the session stopped with stop_reason "awaiting_approval"; its waiting calls are the tool.confirm
// events since the session last started running (operator_preview only covers ask_operator, not tool approvals).
import { sql } from "./db";
import { optional, list } from "./env";

const NAIVE = "https://api.vetta.sh/v1";
const ROLES = ["CEO", "OPS", "VERIFIER", "FINANCE", "SALES", "DISPUTES"] as const;

function headers() {
  return { Authorization: `Bearer ${optional("NAIVE_API_KEY")}`, "Content-Type": "application/json" };
}
async function getJson(url: string) {
  const r = await fetch(url, { headers: headers() });
  // Naïve event payloads can contain raw control characters, which JSON.parse rejects; blank them out.
  const text = (await r.text()).replace(/[\u0000-\u001F]/g, " ");
  try { return { status: r.status, body: JSON.parse(text) as any }; } catch { return { status: r.status, body: {} as any }; }
}
function agentNames(): Record<string, string> {
  return Object.fromEntries(ROLES.map((r) => [optional(`NAIVE_AGENT_${r}`) ?? "", r.toLowerCase()]).filter(([id]) => id));
}

export interface PendingApproval {
  session_id: string; agent: string; tool: string; tool_call_id: string; args: unknown; requested_at: string;
}

export async function listPending(maxSessions = 30): Promise<PendingApproval[]> {
  const names = agentNames();
  const { body } = await getJson(`${NAIVE}/sessions?limit=${maxSessions}`);
  const since = Date.now() - 24 * 3600e3;
  const sessions = (body.data ?? []).filter((s: any) => names[s.agent_id] && new Date(s.created_at).getTime() > since && s.stop_reason === "awaiting_approval");
  const out: PendingApproval[] = [];
  await Promise.all(sessions.map(async (s: any) => {
    const events: any[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const { body: ev } = await getJson(`${NAIVE}/sessions/${s.id}/events?limit=100${cursor ? `&after_seq=${cursor}` : ""}`);
      events.push(...(ev.data ?? []));
      if (!ev.has_more || !ev.next_cursor) break;
      cursor = ev.next_cursor;
    }
    let lastRun = -1;
    events.forEach((e, i) => { if (e.type === "session.running") lastRun = i; });
    for (const c of events.slice(lastRun + 1).filter((e) => e.type === "tool.confirm")) {
      out.push({ session_id: s.id, agent: names[s.agent_id], tool: c.data?.name, tool_call_id: c.data?.tool_call_id, args: c.data?.args ?? {}, requested_at: c.created_at });
    }
  }));
  return out.sort((a, b) => a.requested_at.localeCompare(b.requested_at));
}

export async function decide(sessionId: string, toolCallId: string, decision: "allow" | "deny", scope: "call" | "session", reason: string) {
  const r = await fetch(`${NAIVE}/sessions/${sessionId}/tool_confirmations`, {
    method: "POST", headers: headers(), body: JSON.stringify({ tool_call_id: toolCallId, decision, scope, reason }),
  });
  await sql`insert into agent_events (type, session_id, summary, payload)
            values ('approval', ${sessionId}, ${`${decision} (${scope}): ${reason}`.slice(0, 300)}, ${sql.json({ toolCallId, decision, scope })})`;
  return { ok: r.ok, status: r.status };
}

/** Founder policy: AUTO_APPROVE_TOOLS=operis.find_people,board_write approves only those tools, session-wide. Off when unset. */
export async function autoApprove() {
  const allowed = list("AUTO_APPROVE_TOOLS");
  if (!allowed.length) return { enabled: false, approved: 0 };
  let approved = 0;
  for (const p of await listPending()) {
    if (!allowed.includes(p.tool)) continue;
    const r = await decide(p.session_id, p.tool_call_id, "allow", "session", `auto-approved by founder policy (AUTO_APPROVE_TOOLS) for ${p.agent}`);
    if (r.ok) approved++;
  }
  return { enabled: true, approved };
}
