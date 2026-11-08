// Public MCP server for customer agents: request_human, get_job, cancel_job.
import { serveMcp } from "@/mcp/server";
import { authCustomer } from "@/lib/auth";
import { makeContext } from "@/tools/context";
import { requestHuman, getJob, cancelJob } from "@/tools/edwin";
import { createHold } from "@/tools/registry";
import { apiBaseUrl } from "@/lib/env";

const INSTRUCTIONS = `Operis sends a verified human to do a real-world task for you in San Francisco (within 8 km of the YC office):
photograph or verify a place, pick up and ship an item, or receive/scan/mail paperwork.
1) Call request_human with a clear title, instructions, location (address + lat/lng), deadline (>= 15 min away), budget_usd (>= 20) and the proof you need (photos.must_show, geofence_m).
2) If escrow_url is non-null, open/pay it to fund the job (card is held, charged only when proof passes). If null, no payment is needed (test mode).
3) Poll get_job every few minutes (or pass callback_url). When status is "paid" the proof_package has photo URLs and the verifier score.
Not allowed: CAPTCHAs, verification codes, account sign-ups/logins, impersonation, handling cards/IDs, surveillance of people, licensed work, signing anything.
Guide: ${apiBaseUrl()}/llms.txt`;

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  const customer = await authCustomer(req);
  if (!customer)
    return Response.json({
      error: "unauthorized: send Authorization: Bearer <your Operis key>",
      get_a_key: `curl -X POST ${apiBaseUrl()}/v1/customers -H 'Content-Type: application/json' -d '{"name":"Your agent","contact_email":"you@example.com"}'`,
      agents: "AI agents can sign themselves up: POST /v1/customers (with your owner's email), then call this endpoint with the key. Steps: /llms.txt",
      guide: `${apiBaseUrl()}/llms.txt`,
    }, { status: 401 });
  const ctx = makeContext();
  return serveMcp(req, "operis", {
    request_human: (a) => requestHuman(a, ctx, customer.id, createHold),
    get_job: async (a) => {
      const [j] = await ctx.sql`select customer_id from jobs where id = ${a.job_id}`;
      if (!j || j.customer_id !== customer.id) throw new Error("job not found");
      const out: any = await getJob(a, ctx);
      delete out.fee_usd; delete out.worker_pay_usd; // internal economics
      return out;
    },
    cancel_job: (a) => cancelJob(a, ctx, customer.id),
  }, INSTRUCTIONS);
}
export { handle as GET, handle as POST, handle as DELETE };
