// GET: Naïve approvals waiting for a founder. POST { session_id, tool_call_id, decision: allow|deny, scope: call|session }.
import { authAdmin } from "@/lib/auth";
import { listPending, decide } from "@/lib/approvals";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!authAdmin(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ items: await listPending() });
}
export async function POST(req: Request) {
  if (!authAdmin(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!b.session_id || !b.tool_call_id || !["allow", "deny"].includes(b.decision)) return Response.json({ error: "need session_id, tool_call_id, decision" }, { status: 400 });
  const scope = b.scope === "session" ? "session" : "call";
  const r = await decide(b.session_id, b.tool_call_id, b.decision, scope, b.reason ?? `founder ${b.decision} (${scope}) via console`);
  return Response.json(r, { status: r.ok ? 200 : 502 });
}
