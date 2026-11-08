// Public MCP server for customer agents: request_human, get_job, cancel_job, setup_payment.
import { serveMcp } from "@/mcp/server";
import { authCustomer } from "@/lib/auth";
import { makeContext } from "@/tools/context";
import { requestHuman, getJob, cancelJob, setupPayment } from "@/tools/edwin";
import { createHold, createPaymentSetupLink } from "@/tools/registry";
import { apiBaseUrl } from "@/lib/env";
import { publicOrigin, CORS } from "@/lib/oauth";
import { logCall, requestIp, summarize, userAgent } from "@/lib/apiCalls";
import { stripeTestMode } from "@/lib/stripe-mode";

const INSTRUCTIONS = `Operis sends a verified human to do a real-world task for you in San Francisco (within 8 km of the YC office):
photograph or verify a place, pick up and ship an item, or receive/scan/mail paperwork.
1) Call request_human with a clear title, instructions, location (address + lat/lng), deadline (>= 15 min away), budget_usd (>= 20) and the proof you need (photos.must_show, geofence_m).
2) Check status: "held" means funded (escrow_url is null; the card is held, charged only when proof passes). "requested" means your human owner pays escrow_url once. To fund jobs with no link, call setup_payment once and have your owner save a card, or pass payment.payment_method${stripeTestMode() ? " (test mode: pm_card_visa)" : ""}.
3) Poll get_job every few minutes (or pass callback_url). When status is "paid" the proof_package has photo URLs and the verifier score.
Not allowed: CAPTCHAs, verification codes, account sign-ups/logins, impersonation, handling cards/IDs, surveillance of people, licensed work, signing anything.
Guide: ${apiBaseUrl()}/llms.txt`;

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** JSON-RPC messages in this request (single or batch), for the call log. Never throws. */
async function rpcMessages(req: Request): Promise<{ method?: string; params?: any }[]> {
  if (req.method !== "POST") return [];
  try {
    const body = JSON.parse(await req.clone().text());
    return Array.isArray(body) ? body : [body];
  } catch {
    return [];
  }
}

const NOISE = /^notifications\//; // initialized/cancelled pings: not worth a row

async function handle(req: Request) {
  const msgs = await rpcMessages(req);
  const customer = await authCustomer(req);
  const ip = requestIp(req);
  const init = msgs.find((m) => m.method === "initialize")?.params?.clientInfo;
  const client = init ? `${init.name ?? "client"}${init.version ? ` ${init.version}` : ""}` : userAgent(req);
  if (!customer) {
    const first = msgs.find((m) => m.method && !NOISE.test(m.method));
    if (first || req.method === "POST")
      logCall({ channel: "mcp", method: first?.method ?? req.method, tool: first?.params?.name ?? null, outcome: "unauthorized", http_status: 401,
                summary: "called without an API key (sent sign-up / OAuth instructions)", client, ip });
  } else {
    // tools/call rows come from serveMcp's onCall below; log the other methods here.
    for (const m of msgs) {
      if (!m.method || m.method === "tools/call" || NOISE.test(m.method)) continue;
      logCall({ customer, channel: "mcp", method: m.method, outcome: "ok", http_status: 200, client, ip,
                summary: m.method === "initialize" ? `connected${init ? ` from ${client}` : ""}` : m.method === "tools/list" ? "listed the tools" : m.method });
    }
  }
  if (!customer)
    return Response.json({
      error: "unauthorized: send Authorization: Bearer <your Operis key>",
      get_a_key: `curl -X POST ${apiBaseUrl()}/v1/customers -H 'Content-Type: application/json' -d '{"name":"Your agent","contact_email":"you@example.com"}'`,
      agents: "AI agents can sign themselves up: POST /v1/customers (with your owner's email), then call this endpoint with the key. Steps: /llms.txt",
      guide: `${apiBaseUrl()}/llms.txt`,
    }, {
      status: 401,
      // MCP authorization: clients that support OAuth discover sign-in from here
      headers: { ...CORS, "WWW-Authenticate": `Bearer resource_metadata="${publicOrigin(req)}/.well-known/oauth-protected-resource"` },
    });
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
    setup_payment: () => setupPayment(customer.id, createPaymentSetupLink),
  }, INSTRUCTIONS, (e) => {
    const s = e.ok ? summarize(e.tool, e.args, e.out) : { summary: `${e.tool} failed: ${e.error?.message ?? ""}`, job_id: e.args?.job_id ?? null, outcome: "error" as const };
    logCall({ customer, channel: "mcp", method: "tools/call", tool: e.tool, outcome: s.outcome, http_status: 200, duration_ms: e.ms,
              job_id: s.job_id, summary: s.summary, client, ip });
  });
}
export { handle as GET, handle as POST, handle as DELETE };
