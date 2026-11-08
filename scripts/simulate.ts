// Plays the human worker for a job while the real Naïve agents run the company.
// Usage: npm run simulate -- <job_id>        (or no id: uses the newest job)
// Waits for Ops to send outreach, accepts, uploads a proof near the job, then watches the job finish.
// Every job needs a worker with a verified Stripe Identity: verify the worker first, or run the API with IDENTITY_GATE=log.
import postgres from "postgres";
import { API } from "./env";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let jobId = process.argv[2];
if (!jobId) [{ id: jobId }] = await sql`select id from jobs order by created_at desc limit 1`;
console.log(`job ${jobId}`);

let last = "";
async function status() {
  const [j] = await sql`select status, lat, lng from jobs where id = ${jobId}`;
  if (j.status !== last) { console.log(`${new Date().toLocaleTimeString()}  → ${j.status}`); last = j.status; }
  return j;
}

async function waitFor(pred: () => Promise<boolean>, label: string, timeoutMs = 10 * 60e3) {
  const t0 = Date.now();
  while (!(await pred())) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(3000);
  }
}

let token = "";
await waitFor(async () => {
  await status();
  const [o] = await sql`select token from outreach where job_id = ${jobId} order by created_at limit 1`;
  token = o?.token ?? "";
  return !!token;
}, "Ops to send outreach (find_people → send_blast)");
console.log(`worker link: ${API}/j/${token}`);

const page = await fetch(`${API}/v1/worker/jobs/${token}`).then((r) => r.json());
console.log(`job page: "${page.job.title}" pays $${page.job.pay_usd}`);
const acc = await fetch(`${API}/v1/worker/jobs/${token}/accept`, { method: "POST" }).then((r) => r.json());
console.log(`accept: ${JSON.stringify(acc)}`);
if (!acc.ok) {
  const needsId = JSON.stringify(acc).includes("identity_not_verified");
  console.log(needsId ? "accept refused: this worker has no verified Stripe Identity. Verify them first, or run the API with IDENTITY_GATE=log." : "accept refused");
  process.exit(1);
}

await sleep(2000);
const j = await status();
const n = page.job.proof_requirement?.photos?.min ?? 2;
const media = Array.from({ length: n }, (_, i) => ({ url: `https://picsum.photos/seed/operis-${i}/800`, kind: "image/jpeg" }));
const pr = await fetch(`${API}/v1/worker/jobs/${token}/proof`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ media, gps_lat: j.lat + 0.0002, gps_lng: j.lng, captured_at: new Date().toISOString() }),
}).then((r) => r.json());
console.log(`proof: ${JSON.stringify(pr)}`);

await waitFor(async () => ["paid", "escalated", "rejected", "refunded"].includes((await status()).status), "Verifier + Finance");
const wakes = await sql`select event, naive_session_id from wake_events where job_id = ${jobId} order by created_at`;
console.log("\nagent wake-ups:"); for (const w of wakes) console.log(`  ${w.event.padEnd(16)} ${w.naive_session_id ?? "(no agent configured)"}`);
const money = await sql`select kind, amount_usd from ledger where job_id = ${jobId} order by created_at`;
console.log("ledger:"); for (const m of money) console.log(`  ${m.kind.padEnd(8)} $${m.amount_usd}`);
await sql.end();
