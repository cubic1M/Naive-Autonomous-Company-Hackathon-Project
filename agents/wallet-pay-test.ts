// The judge moment, ready for the day Naïve turns wallets on: a Naïve identity's own wallet pays an Operis job over
// x402 (the same call an agent makes with its wallet.pay tool). Safe to run any time: while custody is off it stops at
// "501 feature_not_configured" and changes nothing.
//
//   npx tsx agents/wallet-pay-test.ts                       check: does our org have wallets yet?
//   npx tsx agents/wallet-pay-test.ts --fund 20             + top the testnet wallet up from Naïve's faucet (1 USDC per call)
//   npx tsx agents/wallet-pay-test.ts --pay <x402_url>      + quote and pay a job's x402 url (from request_human's x402.url)
import { readFileSync, existsSync } from "node:fs";

const env = existsSync("apps/api/.env.local") ? readFileSync("apps/api/.env.local", "utf8") : "";
const KEY = process.env.NAIVE_API_KEY ?? env.match(/^NAIVE_API_KEY=(.*)$/m)?.[1]?.replace(/"/g, "");
const NAIVE = "https://api.vetta.sh/v1";
const IDENTITY = process.env.NAIVE_WALLET_IDENTITY ?? "operis-x402-probe";
const NETWORK = process.env.X402_NETWORK ?? "eip155:84532";
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };

async function api(method: string, path: string, body?: unknown, idem?: string) {
  const r = await fetch(`${NAIVE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
}

// 1. the identity's wallet (create it if wallets are on), with a cap a $20-$30 job fits under
let w = await api("GET", `/identities/${IDENTITY}/wallet?network=${NETWORK}`);
if (w.status === 404) {
  w = await api("POST", `/identities/${IDENTITY}/wallet`, { network: NETWORK, policy: { per_tx_cap_micro_usd: 30_000_000, daily_cap_micro_usd: 60_000_000 } }, `operis-wallet-${IDENTITY}`);
}
if (w.status === 501) {
  console.log(`Naïve wallets are still OFF for this org: ${w.body?.error?.message ?? "feature_not_configured"}. Ask Naïve to bind custody (Base Sepolia).`);
  process.exit(0);
}
if (w.status >= 400) throw new Error(`wallet → ${w.status} ${JSON.stringify(w.body).slice(0, 300)}`);
console.log(`✓ wallet ${w.body.address} on ${w.body.network}: balance $${(w.body.balance_micro_usd ?? 0) / 1e6}, cap $${(w.body.policy?.per_tx_cap_micro_usd ?? 0) / 1e6}/payment`);

// 2. testnet funding from Naïve's faucet (1 USDC per call)
const fund = Number(arg("--fund") ?? 0);
for (let i = 0; i < fund; i++) {
  const f = await api("POST", `/identities/${IDENTITY}/wallet/fund?network=${NETWORK}`, { source: "faucet", amount_micro_usd: 1_000_000 }, `operis-faucet-${Date.now()}-${i}`);
  if (f.status >= 400) { console.log(`faucet stopped after ${i}: ${f.status} ${f.body?.error?.code ?? ""}`); break; }
}
if (fund) console.log(`✓ funded up to ${fund} USDC from the faucet`);

// 3. quote + pay an Operis job's x402 url: exactly what wallet.pay does for an agent
const url = arg("--pay");
if (url) {
  const q = await api("POST", `/identities/${IDENTITY}/wallet/quote?network=${NETWORK}`, { url, method: "GET" });
  console.log("quote:", JSON.stringify(q.body).slice(0, 400));
  if (!q.body?.payable) throw new Error("Naïve says this url isn't payable (check X402_ENABLED and the job's status)");
  const p = await api("POST", `/identities/${IDENTITY}/wallet/pay?network=${NETWORK}`, { url, max_amount_micro_usd: q.body.amount_micro_usd }, `operis-pay-${url}`);
  console.log(`pay → ${p.status}:`, JSON.stringify(p.body).slice(0, 600));
}
