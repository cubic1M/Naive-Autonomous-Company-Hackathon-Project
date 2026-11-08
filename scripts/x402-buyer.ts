// A test "customer agent" that hires a human and pays in USDC over x402, no human in the loop.
// It is what Naïve's wallet.pay will do once Naïve turns wallets on; until then it proves our side end to end.
//
//   X402_BUYER_PRIVATE_KEY=0x…   a Base Sepolia wallet holding test USDC (https://faucet.circle.com → Base Sepolia)
//   OPERIS_API_KEY=opk_…         a customer key (operis.live/developers)
//   API=https://api.operis.live  (default; http://localhost:3001 for local)
//   npx tsx scripts/x402-buyer.ts                 posts a demo job and pays it
//   npx tsx scripts/x402-buyer.ts <job_id>        pays an existing job's x402 url
//   npx tsx scripts/x402-buyer.ts --new-wallet    prints a fresh buyer key + address to fund from the faucet
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const API = (process.env.API ?? "https://api.operis.live").replace(/\/$/, "");
const NETWORK = (process.env.X402_NETWORK ?? "eip155:84532") as `${string}:${string}`;

if (process.argv.includes("--new-wallet")) {
  const k = generatePrivateKey();
  console.log(`X402_BUYER_PRIVATE_KEY=${k}\naddress: ${privateKeyToAccount(k).address}\nFund it: https://faucet.circle.com (Base Sepolia, USDC)`);
  process.exit(0);
}

const key = process.env.X402_BUYER_PRIVATE_KEY as `0x${string}` | undefined;
if (!key) throw new Error("set X402_BUYER_PRIVATE_KEY (or run with --new-wallet)");
const account = privateKeyToAccount(key);
console.log(`buyer wallet ${account.address} on ${NETWORK}`);

async function mcp(name: string, args: Record<string, unknown>) {
  const r = await fetch(`${API}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPERIS_API_KEY}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const j: any = await r.json();
  return JSON.parse(j.result?.content?.[0]?.text ?? "{}");
}

let jobId = process.argv[2];
let url: string;
if (!jobId) {
  if (!process.env.OPERIS_API_KEY) throw new Error("set OPERIS_API_KEY to post a job, or pass a job id");
  const deadline = new Date(Date.now() + 6 * 3600e3).toISOString();
  const out = await mcp("request_human", {
    title: "Photograph the Ferry Building clock tower (x402 test)",
    instructions: "2 photos from the Embarcadero plaza: the whole tower with the clock readable, and the main entrance sign.",
    location: { address: "1 Ferry Building, San Francisco, CA 94111", lat: 37.7955, lng: -122.3937 },
    deadline, budget_usd: 20, certification_required: null,
    proof: { photos: { min: 2, must_show: ["clock tower", "Ferry Building sign"] }, geofence_m: 150 },
  });
  console.log("request_human →", JSON.stringify({ job_id: out.job_id, status: out.status, x402: out.x402 }, null, 1));
  if (!out.x402?.url) throw new Error("no x402 offer: is X402_ENABLED=true on the API?");
  jobId = out.job_id;
  url = out.x402.url;
} else {
  url = `${API}/x402/jobs/${jobId}/fund`;
}

const pay = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }] });
const t0 = Date.now();
const res = await pay(url, { method: "GET" });
console.log(`GET ${url} → ${res.status} in ${Date.now() - t0} ms`);
console.log(await res.text());
const settlement = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
if (settlement) console.log("settlement:", Buffer.from(settlement, "base64").toString());
if (process.env.OPERIS_API_KEY) console.log("get_job →", JSON.stringify(await mcp("get_job", { job_id: jobId })).slice(0, 300));
