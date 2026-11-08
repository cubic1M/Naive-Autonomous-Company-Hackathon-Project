// x402: an agent's wallet funds a job in USDC with no human (Naïve's wallet.pay, Coinbase agent wallets, @x402 clients).
// Off unless X402_ENABLED=true. Testnet by default (Base Sepolia + the public x402.org facilitator).
//
//   X402_ENABLED=true
//   X402_PAY_TO=0x…                       our receiving address (scripts/x402-treasury.ts makes one)
//   X402_NETWORK=eip155:84532             Base Sepolia (default) | eip155:8453 Base mainnet (needs a mainnet facilitator)
//   X402_FACILITATOR_URL=https://x402.org/facilitator   (default; testnet only)
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { sql } from "@/lib/db";
import { apiBaseUrl, flag, optional } from "@/lib/env";

export const x402Enabled = () => flag("X402_ENABLED") && !!optional("X402_PAY_TO");
export const x402Network = () => (optional("X402_NETWORK") ?? "eip155:84532") as `${string}:${string}`;
export const x402PayTo = () => optional("X402_PAY_TO")!;
export const x402FundUrl = (jobId: string) => `${apiBaseUrl()}/x402/jobs/${jobId}/fund`;
export const networkLabel = (n: string) => (n === "eip155:8453" ? "Base" : n === "eip155:84532" ? "Base Sepolia (testnet)" : n);

let server: x402ResourceServer | null = null;
/** One resource server per instance: the facilitator verifies and settles; ExactEvmScheme prices USDC on EVM networks. */
export function x402Server(): x402ResourceServer {
  if (!server) {
    const facilitator = new HTTPFacilitatorClient({ url: optional("X402_FACILITATOR_URL") ?? "https://x402.org/facilitator" });
    server = new x402ResourceServer(facilitator).register("eip155:*", new ExactEvmScheme());
  }
  return server;
}

/** What request_human tells the agent when x402 is on. */
export function x402Offer(jobId: string, amountUsd: number) {
  return {
    url: x402FundUrl(jobId),
    method: "GET",
    network: x402Network(),
    asset: "USDC",
    amount_usd: amountUsd,
    how: "Any x402 wallet: GET the url, pay the 402 it answers, and the job is funded (status held). On Naïve: wallet.pay with this url.",
  };
}

/** The job's x402 payment, if it was funded that way. */
export async function x402Payment(jobId: string): Promise<{ status: string; amount_micro_usd: string; payer: string | null; tx_hash: string | null; network: string; refund_status: string | null } | null> {
  try {
    const [p] = await sql`select status, amount_micro_usd, payer, tx_hash, network, refund_status from x402_payments where job_id = ${jobId}`;
    return (p as any) ?? null;
  } catch {
    return null; // table missing before migration 013
  }
}
export const isX402Funded = async (jobId: string) => (await x402Payment(jobId))?.status === "settled";

/**
 * A USDC-funded job that must give money back (cancelled after funding, expired, rejected proof): we can't refund
 * through Stripe, so mark the refund due and tell the founders in the agent feed. scripts/x402-refund.ts sends it.
 */
export async function markX402RefundDue(jobId: string, reason: string) {
  const [p] = await sql`update x402_payments set refund_status = 'due', updated_at = now()
                        where job_id = ${jobId} and status = 'settled' and refund_status is null
                        returning amount_micro_usd, payer, network`;
  if (!p) return null;
  const usd = Number(p.amount_micro_usd) / 1_000_000;
  await sql`insert into agent_events (type, agent, job_id, summary)
            values ('x402.refund_due', 'finance', ${jobId}, ${`USDC refund due: $${usd} to ${p.payer} on ${networkLabel(p.network)} (${reason}). Run scripts/x402-refund.ts.`})`
    .catch(() => null);
  return { status: "refund_due_usdc", amount_usd: usd, to: p.payer, network: p.network };
}
