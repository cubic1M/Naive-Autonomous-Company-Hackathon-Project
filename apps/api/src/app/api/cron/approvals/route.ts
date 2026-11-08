// Every minute: apply the founder's AUTO_APPROVE_TOOLS policy (no-op when unset).
import { autoApprove } from "@/lib/approvals";
import { authAdmin } from "@/lib/auth";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(req: Request) {
  const cron = process.env.CRON_SECRET && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  if (!cron && !authAdmin(req)) return new Response("unauthorized", { status: 401 });
  const r = await autoApprove();
  if (r.approved) console.log("[auto-approve]", r);
  return Response.json(r);
}
