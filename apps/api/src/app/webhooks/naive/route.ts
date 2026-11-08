// Naïve outbound webhooks (session.idle, tool.confirm, budget.exceeded, ...). Logged to agent_events
// for the dashboard's agent feed. Auth: ?k=NAIVE_WEBHOOK_SECRET on the registered URL.
import { sql } from "@/lib/db";
import { autoApproveReason, decide, roleForAgent } from "@/lib/approvals";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const k = new URL(req.url).searchParams.get("k");
  if (!process.env.NAIVE_WEBHOOK_SECRET || k !== process.env.NAIVE_WEBHOOK_SECRET) return new Response("unauthorized", { status: 401 });
  const evt = await req.json();
  const type = evt.type ?? evt.event ?? "unknown";
  const data = evt.data ?? evt;
  const summary =
    type === "tool.started" || type === "tool.completed" ? `${type}: ${data?.tool?.name ?? data?.name ?? ""}` :
    type === "tool.confirm" ? `waiting for founder approval: ${data?.tool?.name ?? data?.name ?? ""}` :
    type === "budget.exceeded" ? "budget exceeded" : type;
  await sql`insert into agent_events (type, agent_id, session_id, summary, payload)
            values (${type}, ${data?.agent_id ?? null}, ${data?.session_id ?? evt.session_id ?? null}, ${summary}, ${sql.json(evt)})`;
  // If Naïve delivers tool.confirm (today it only sends session.idle; the cron covers that), apply the
  // founder auto-approve policy immediately.
  if (type === "tool.confirm") {
    const role = roleForAgent(data?.agent_id ?? evt.agent_id);
    const tool = data?.name ?? data?.tool?.name;
    const sessionId = data?.session_id ?? evt.session_id;
    const callId = data?.tool_call_id;
    const reason = role && tool ? autoApproveReason(role, tool) : null;
    if (reason && sessionId && callId) await decide(sessionId, callId, "allow", "session", reason);
    else console.warn(`[naive] ⚠️ ${summary} (waiting for a founder)`);
  }
  if (type === "budget.exceeded") console.warn(`[naive] ⚠️ ${summary}`);
  return Response.json({ ok: true });
}
