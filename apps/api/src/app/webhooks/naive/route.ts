// Naïve outbound webhooks (session.idle, tool.confirm, budget.exceeded, ...). Logged to agent_events
// for the dashboard's agent feed. Auth: ?k=NAIVE_WEBHOOK_SECRET on the registered URL.
import { sql } from "@/lib/db";
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
  if (type === "tool.confirm" || type === "budget.exceeded") console.warn(`[naive] ⚠️ ${summary}`);
  return Response.json({ ok: true });
}
