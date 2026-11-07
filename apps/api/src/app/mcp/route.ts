// Public MCP server for customer agents: request_human, get_job, cancel_job.
import { serveMcp } from "@/mcp/server";
import { authCustomer } from "@/lib/auth";
import { makeContext } from "@/tools/context";
import { requestHuman, getJob, cancelJob } from "@/tools/edwin";
import { createHold } from "@/tools/registry";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  const customer = await authCustomer(req);
  if (!customer) return Response.json({ error: "unauthorized: send Authorization: Bearer <your Operis key>" }, { status: 401 });
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
  });
}
export { handle as GET, handle as POST, handle as DELETE };
