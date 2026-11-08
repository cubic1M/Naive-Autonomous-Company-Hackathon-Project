// Vercel cron (apps/api/vercel.json) calls this every 5 minutes with Authorization: Bearer $CRON_SECRET.
import { sweep } from "@/lib/sweep";
import { authAdmin } from "@/lib/auth";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const cron = process.env.CRON_SECRET && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  if (!cron && !authAdmin(req)) return new Response("unauthorized", { status: 401 });
  const report = await sweep();
  if (report.cancelled || report.expired || report.nudged || report.liability || report.redriven || report.holdsReleased || report.holdsExpired || report.errors.length) console.log("[sweep]", JSON.stringify(report));
  return Response.json(report);
}
