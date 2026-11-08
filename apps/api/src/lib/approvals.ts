// Naïve "ask" approvals for our agents. Naïve pauses calls flagged read_people (find_people, board_write
// with an assignee, approve_proof, payout...) for a human even when the tool is set to allow.
// Pending = the session stopped with stop_reason "awaiting_approval"; its waiting calls are the tool.confirm
// events since the session last started running (operator_preview only covers ask_operator, not tool approvals).
import { sql } from "./db";
import { optional, list } from "./env";
import agentsConfig from "@agents/agents.json";

const NAIVE = "https://api.vetta.sh/v1";
const ROLES = ["CEO", "OPS", "VERIFIER", "FINANCE", "SALES", "DISPUTES", "COMPLIANCE", "RECRUITER"] as const;

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

// ---------- founder auto-approve policy ----------
// A waiting call is auto-approved when the tool is in AUTO_APPROVE_TOOLS, or when
// AUTO_APPROVE_FROM_AGENTS_JSON=true and agents/agents.json marks that tool "allow" for that agent's role.
// ask_operator and email.send always stay with a human.

const HUMAN_ONLY = new Set(["ask_operator", "email.send"]);

function agentsJsonAllows(role: string, tool: string): boolean {
  const cfg: any = agentsConfig;
  const spec = role === "ceo" ? cfg.ceo : cfg.members?.[role];
  return spec?.tools?.[tool] === "allow";
}

/** Why a call may be auto-approved, or null if it must wait for a human. */
export function autoApproveReason(role: string, tool: string): string | null {
  if (!tool || HUMAN_ONLY.has(tool)) return null;
  if (list("AUTO_APPROVE_TOOLS").includes(tool)) return `auto-approved by founder policy (AUTO_APPROVE_TOOLS) for ${role}`;
  if (["1", "true", "yes", "on"].includes((process.env.AUTO_APPROVE_FROM_AGENTS_JSON ?? "").toLowerCase()) && agentsJsonAllows(role, tool))
    return `auto-approved by founder policy (agents.json allows ${tool} for ${role})`;
  return null;
}

export function autoApproveEnabled(): boolean {
  return list("AUTO_APPROVE_TOOLS").length > 0 || ["1", "true", "yes", "on"].includes((process.env.AUTO_APPROVE_FROM_AGENTS_JSON ?? "").toLowerCase());
}

/** Approve every waiting call the policy allows (session-scoped). No-op when no policy is on. */
export async function autoApprove() {
  if (!autoApproveEnabled()) return { enabled: false, approved: 0 };
  let approved = 0;
  for (const p of await listPending()) {
    const reason = autoApproveReason(p.agent, p.tool);
    if (!reason) continue;
    const r = await decide(p.session_id, p.tool_call_id, "allow", "session", reason);
    if (r.ok) approved++;
  }
  return { enabled: true, approved };
}

/** Run autoApprove repeatedly for ~budgetMs (cron invocations last up to 60 s), every intervalMs (25 s: Naïve rate-limits faster polling). */
export async function autoApproveLoop(budgetMs = 50_000, intervalMs = 25_000) {
  const start = Date.now();
  let approved = 0, passes = 0, enabled = false;
  do {
    const r = await autoApprove();
    enabled = r.enabled; approved += r.approved; passes++;
    if (!r.enabled) break;
    const left = budgetMs - (Date.now() - start);
    if (left < intervalMs) break;
    await new Promise((res) => setTimeout(res, intervalMs));
  } while (Date.now() - start < budgetMs);
  return { enabled, approved, passes };
}

/** Role for a Naïve agent id (NAIVE_AGENT_*), for webhook events that only carry agent_id. */
export function roleForAgent(agentId: string | null | undefined): string | null {
  if (!agentId) return null;
  for (const r of ROLES) if (optional(`NAIVE_AGENT_${r}`) === agentId) return r.toLowerCase();
  return null;
}
