// GET /x402/jobs/{id}/fund: an agent's wallet funds a job in USDC, no human. Unpaid → 402 with the price (the job's
// worker pay + fee, the same as the Stripe hold) and our address; paid → the facilitator verifies, we claim the job
// (so two wallets can't both pay it), the payment settles onchain, then the job moves to held and Compliance wakes.
// Naïve's wallet.pay calls this URL as-is (it takes a URL, no body), so the job id lives in the path.
import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { sql } from "@/lib/db";
import { markFunded } from "@/tools/edwin";
import { makeContext } from "@/tools/context";
import { x402Enabled, x402Network, x402PayTo, x402Server, networkLabel } from "@/lib/x402";
import { logCall, requestIp, userAgent } from "@/lib/apiCalls";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jobIdFrom = (path: string) => path.split("/")[3] ?? "";

async function payableJob(id: string) {
  if (!UUID.test(id)) return null;
  const [j] = await sql`select j.id, j.status, j.title, j.worker_pay_usd, j.fee_usd, j.customer_id, c.name as customer_name
                        from jobs j left join customers c on c.id = j.customer_id where j.id = ${id}`;
  return j ?? null;
}
const chargeUsd = (j: any) => Math.round((Number(j.worker_pay_usd) + Number(j.fee_usd)) * 100) / 100;

// Runs after the facilitator verified the payment and BEFORE it settles: claim the job, so a second payment for the
// same job is refused (409, never settled). withX402 settles only when this answers < 400.
async function claim(req: NextRequest): Promise<NextResponse> {
  const id = jobIdFrom(new URL(req.url).pathname);
  const j = await payableJob(id);
  if (!j || j.status !== "requested") return NextResponse.json({ error: "not_payable", status: j?.status ?? "not_found" }, { status: 409 });
  const amount = Math.round(chargeUsd(j) * 1_000_000);
  const [c] = await sql`insert into x402_payments (job_id, status, network, pay_to, amount_micro_usd)
                        values (${id}, 'settling', ${x402Network()}, ${x402PayTo()}, ${amount})
                        on conflict (job_id) do update set status = 'settling', updated_at = now() where x402_payments.status = 'failed'
                        returning job_id`;
  if (!c) return NextResponse.json({ error: "already_paid_or_settling" }, { status: 409 });
  return NextResponse.json({ job_id: id, funded: true, title: j.title, amount_usd: chargeUsd(j), network: networkLabel(x402Network()) });
}

const protectedGet = withX402(
  claim,
  {
    "/x402/jobs/[id]/fund": {
      accepts: [{
        scheme: "exact",
        network: x402Network(),
        payTo: () => x402PayTo(),
        // the job's own price, read per request
        price: async (ctx) => {
          const j = await payableJob(jobIdFrom(ctx.adapter.getPath()));
          return `$${(j ? chargeUsd(j) : 0).toFixed(2)}`;
        },
        maxTimeoutSeconds: 120,
      }],
      description: "Fund an Operis job: a verified human does it, paid out only when proof passes.",
      mimeType: "application/json",
    },
  },
  x402Server(),
);

export async function GET(req: NextRequest) {
  if (!x402Enabled()) return NextResponse.json({ error: "x402_disabled", message: "USDC payments aren't switched on; pay the job's escrow_url instead." }, { status: 404 });
  const id = jobIdFrom(new URL(req.url).pathname);
  const j = await payableJob(id);
  if (!j) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (j.status !== "requested") return NextResponse.json({ error: "not_payable", status: j.status, message: "This job is already funded or closed." }, { status: 409 });

  const res = await protectedGet(req);
  const header = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
  const customer = j.customer_id ? { id: j.customer_id, name: j.customer_name ?? "?" } : null;
  if (res.status >= 400 || !header) {
    // 402 (unpaid), a refused payment, or a failed settlement: release a claim we may have made.
    if (res.status !== 402) await sql`update x402_payments set status = 'failed', updated_at = now() where job_id = ${id} and status = 'settling'`;
    logCall({ customer, channel: "mcp", method: "x402", tool: "fund", outcome: res.status === 402 ? "ok" : "error", http_status: res.status, job_id: id,
              summary: res.status === 402 ? `x402: quoted $${chargeUsd(j)} USDC on ${networkLabel(x402Network())}` : `x402 payment failed (${res.status})`,
              client: userAgent(req), ip: requestIp(req) });
    return res;
  }
  try {
    const settled: any = decodePaymentResponseHeader(header);
    if (!settled?.success) throw new Error(`settlement not successful: ${JSON.stringify(settled).slice(0, 200)}`);
    await sql`update x402_payments set status = 'settled', payer = ${settled.payer ?? null}, tx_hash = ${settled.transaction ?? null}, updated_at = now()
              where job_id = ${id}`;
    // The USDC already moved: the escrow is captured, so Cameron's payout works unchanged once proof passes.
    await sql`insert into escrows (job_id, amount_cents, status) values (${id}, ${Math.round(chargeUsd(j) * 100)}, 'captured')
              on conflict (job_id) do update set status = 'captured', updated_at = now()`;
    await markFunded(makeContext(), id);
    logCall({ customer, channel: "mcp", method: "x402", tool: "fund", outcome: "ok", http_status: 200, job_id: id,
              summary: `x402: paid $${chargeUsd(j)} USDC on ${networkLabel(x402Network())} → funded (tx ${String(settled.transaction ?? "").slice(0, 12)}…)`,
              client: userAgent(req), ip: requestIp(req) });
  } catch (e) {
    // The money may have moved: never drop it silently. A founder reconciles from x402_payments (status settling).
    console.error(`[x402] job ${id}: settled but not recorded`, e);
  }
  return res;
}
