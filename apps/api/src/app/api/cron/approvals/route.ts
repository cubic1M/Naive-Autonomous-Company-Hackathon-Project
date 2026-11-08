// Every minute (Vercel cron): pull agent activity from Naïve once, then apply the founder auto-approve policy
// every ~8 s for ~50 s, so routine calls wait seconds, not a minute. No-op when no policy is on.
import { autoApproveLoop } from "@/lib/approvals";
import { syncAgentFeed } from "@/lib/agentFeed";
import { authAdmin } from "@/lib/auth";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const cron = process.env.CRON_SECRET && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  if (!cron && !authAdmin(req)) return new Response("unauthorized", { status: 401 });
  const quick = new URL(req.url).searchParams.get("once") === "1"; // manual check: one pass
  const feed = await syncAgentFeed().catch((e) => { console.error("[agent-feed]", e); return -1; });
  const r = await autoApproveLoop(quick ? 0 : 50_000);
  if (r.approved) console.log("[auto-approve]", r);
  return Response.json({ ...r, feed_events_added: feed });
}
