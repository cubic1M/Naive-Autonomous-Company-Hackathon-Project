// Pull our agents' Naïve session events into agent_events: tool calls, messages, hand-offs, approvals.
// Naïve's webhook only delivers session.idle, so this polls (cron every minute + throttled on demand).
import { sql } from "./db";
import { optional } from "./env";

const NAIVE = "https://api.vetta.sh/v1";
const ROLES = ["CEO", "OPS", "VERIFIER", "FINANCE", "SALES", "DISPUTES"] as const;
const KEEP = new Set(["tool.started", "tool.completed", "tool.confirm", "message.completed", "handoff.sent", "session.idle", "budget.exceeded"]);

async function get(path: string) {
  const r = await fetch(`${NAIVE}${path}`, { headers: { Authorization: `Bearer ${optional("NAIVE_API_KEY")}` } });
  const t = (await r.text()).replace(/[\u0000-\u001F]/g, " ");
  try { return JSON.parse(t); } catch { return {}; }
}

const clip = (v: unknown, n = 160) => {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
  return s.length > n ? s.slice(0, n) + "…" : s;
};

function summarize(agent: string, e: any): string | null {
  const d = e.data ?? {};
  switch (e.type) {
    case "tool.started": return `${agent} → ${d.name}${d.args ? ` ${clip(d.args, 120)}` : ""}`;
    case "tool.completed": return `${agent} ✓ ${d.name}: ${clip(d.output, 140)}`;
    case "tool.confirm": return `${agent} is waiting for founder approval: ${d.name}`;
    case "message.completed": return d.role === "assistant" && d.content ? `${agent}: ${clip(d.content, 220)}` : null;
    case "handoff.sent": return `${agent} handed off ${clip(d.agents ?? d.to ?? d, 80)}`;
    case "session.idle": return `${agent} finished`;
    case "budget.exceeded": return `${agent} hit its budget`;
    default: return null;
  }
}

/** Sync recent sessions. Returns how many events were added. */
export async function syncAgentFeed(maxSessions = 25): Promise<number> {
  const roleOf = new Map(ROLES.map((r) => [optional(`NAIVE_AGENT_${r}`), r.toLowerCase()]).filter(([id]) => id) as [string, string][]);
  if (!roleOf.size || !optional("NAIVE_API_KEY")) return 0;
  const list = await get(`/sessions?limit=${maxSessions}`);
  const since = Date.now() - 24 * 3600e3;
  const sessions = (list.data ?? []).filter((s: any) => roleOf.has(s.agent_id) && new Date(s.created_at).getTime() > since);
  let added = 0;
  for (const s of sessions) {
    const [cur] = await sql`select next_cursor, done from agent_feed_cursors where session_id = ${s.id}`;
    if (cur?.done) continue;
    const agent = roleOf.get(s.agent_id)!;
    const jobId = /^[0-9a-f-]{36}$/.test(s.metadata?.job_id ?? "") ? s.metadata.job_id : null;
    let cursor: string | undefined = cur?.next_cursor ?? undefined;
    let finished = false;
    for (let page = 0; page < 10; page++) {
      const ev = await get(`/sessions/${s.id}/events?limit=100${cursor ? `&after_seq=${cursor}` : ""}`);
      for (const e of ev.data ?? []) {
        if (!KEEP.has(e.type)) continue;
        const summary = summarize(agent, e);
        if (!summary) continue;
        const inserted = await sql`
          insert into agent_events (type, agent_id, agent, session_id, job_id, event_seq, summary, payload, created_at)
          values (${e.type}, ${s.agent_id}, ${agent}, ${s.id}, ${jobId}, ${e.seq}, ${summary},
                  ${sql.json({ name: e.data?.name ?? null })}, ${e.created_at})
          on conflict do nothing returning id`;
        added += inserted.length;
        if (e.type === "session.idle") finished = true;
      }
      if (ev.next_cursor) cursor = String(ev.next_cursor);
      if (!ev.has_more) break;
    }
    const done = finished && ["idle", "terminated", "cancelled", "failed"].includes(s.status);
    await sql`insert into agent_feed_cursors (session_id, next_cursor, done, updated_at) values (${s.id}, ${cursor ?? null}, ${done}, now())
              on conflict (session_id) do update set next_cursor = excluded.next_cursor, done = excluded.done, updated_at = now()`;
  }
  return added;
}

/** On-demand sync at most every `minMs` (for pages that poll). */
export async function syncAgentFeedThrottled(minMs = 20_000) {
  const [row] = await sql`
    insert into app_state (key, value, updated_at) values ('agent_feed_sync', '', now())
    on conflict (key) do update set updated_at = now()
    where app_state.updated_at < now() - make_interval(secs => ${minMs / 1000})
    returning key`;
  if (row) await syncAgentFeed().catch((e) => console.error("[agent-feed]", e));
}
