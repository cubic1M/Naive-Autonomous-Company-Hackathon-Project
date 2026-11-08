// Send due USDC refunds for jobs paid over x402 (x402_payments.refund_status = 'due') from the testnet treasury.
//   DATABASE_URL=… npx tsx scripts/x402-refund.ts            list refunds due
//   DATABASE_URL=… npx tsx scripts/x402-refund.ts --send     send them (needs X402_TREASURY_PRIVATE_KEY + Base Sepolia ETH for gas)
import postgres from "postgres";
import { createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { readFileSync, existsSync } from "node:fs";

const fromEnvFile = (k: string) => (existsSync("apps/api/.env.local") ? readFileSync("apps/api/.env.local", "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.replace(/"/g, "") : undefined);
const sql = postgres(process.env.DATABASE_URL ?? fromEnvFile("DATABASE_URL")!.replace(/\s+#.*$/, ""), { prepare: false });
const USDC: Record<string, `0x${string}`> = { "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" };

const due = await sql`select job_id, payer, amount_micro_usd, network from x402_payments where refund_status = 'due' order by updated_at`;
if (!due.length) { console.log("No USDC refunds due."); process.exit(0); }
for (const d of due) console.log(`due: job ${d.job_id} → ${d.payer} $${Number(d.amount_micro_usd) / 1e6} on ${d.network}`);
if (!process.argv.includes("--send")) { console.log("\nRun with --send to pay them."); process.exit(0); }

const key = (process.env.X402_TREASURY_PRIVATE_KEY ?? fromEnvFile("X402_TREASURY_PRIVATE_KEY")) as `0x${string}`;
if (!key) throw new Error("X402_TREASURY_PRIVATE_KEY not set");
const account = privateKeyToAccount(key);
for (const d of due) {
  const chain = d.network === "eip155:8453" ? base : baseSepolia;
  const wallet = createWalletClient({ account, chain, transport: http() });
  const hash = await wallet.writeContract({
    address: USDC[d.network]!, abi: parseAbi(["function transfer(address to, uint256 value) returns (bool)"]),
    functionName: "transfer", args: [d.payer as `0x${string}`, BigInt(d.amount_micro_usd)],
  });
  await sql`update x402_payments set refund_status = 'sent', refund_tx_hash = ${hash}, updated_at = now() where job_id = ${d.job_id}`;
  await sql`insert into ledger (job_id, kind, amount_usd, ref) values (${d.job_id}, 'refund', ${Number(d.amount_micro_usd) / 1e6}, ${`x402:${hash}`})`.catch(() => null);
  console.log(`✓ refunded job ${d.job_id}: ${hash}`);
}
await sql.end();
