// Every minute: pull agent activity from Naïve, then apply the founder's AUTO_APPROVE_TOOLS policy (no-op when unset).
import { autoApprove } from "@/lib/approvals";
import { syncAgentFeed } from "@/lib/agentFeed";
import { authAdmin } from "@/lib/auth";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(req: Request) {
  const cron = process.env.CRON_SECRET && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  if (!cron && !authAdmin(req)) return new Response("unauthorized", { status: 401 });
  const feed = await syncAgentFeed().catch((e) => { console.error("[agent-feed]", e); return -1; });
  const r = await autoApprove();
  if (r.approved) console.log("[auto-approve]", r);
  return Response.json({ ...r, feed_events_added: feed });
}
