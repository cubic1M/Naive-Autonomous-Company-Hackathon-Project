// Calls every MCP tool once against the API and checks the response shape.
// Usage: npm run smoke            (API defaults to API_BASE_URL or http://localhost:3001)
// Tip: run with the Naïve agents NOT configured on the server, or they'll act on the smoke job too.
// The worker it plays has no Stripe Identity and every job needs one, so run the API with IDENTITY_GATE=log for smoke.
import postgres from "postgres";
import { createHash, randomBytes } from "node:crypto";
import { API } from "./env";
import { mcpClient } from "./mcp";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
const results: { tool: string; ok: boolean; note: string }[] = [];
async function check(tool: string, fn: () => Promise<unknown>, expect: (r: any) => boolean | string) {
  try {
    const r = await fn();
    const e = expect(r);
    results.push({ tool, ok: e === true, note: e === true ? "" : typeof e === "string" ? e : JSON.stringify(r).slice(0, 160) });
    return r as any;
  } catch (err: any) {
    results.push({ tool, ok: false, note: err.message.slice(0, 160) });
  }
}

// a throwaway customer
const key = "opk_smoke_" + randomBytes(12).toString("base64url");
const [cust] = await sql`insert into customers (name, api_key_hash) values ('smoke-test', ${createHash("sha256").update(key).digest("hex")}) returning id`;
const pub = await mcpClient(`${API}/mcp`, key);
const internal = await mcpClient(`${API}/mcp/internal`, process.env.INTERNAL_MCP_KEY!);

const listed = await internal.client.listTools();
console.log(`internal tools: ${listed.tools.map((t) => t.name).join(", ")}`);

const loc = { address: "YC, 335 Pioneer Way area (smoke)", lat: 37.7749, lng: -122.4194 };
const job = await check("request_human", () => pub.call("request_human", {
  title: "Smoke: photograph a sign", instructions: "Two photos of the sign.", location: loc,
  deadline: new Date(Date.now() + 3 * 3600e3).toISOString(), budget_usd: 40, certification_required: null,
  proof: { photos: { min: 2, must_show: ["sign"] }, geofence_m: 150 },
}), (r) => (typeof r.job_id === "string" && r.job_id.length > 0) || "no job_id");
const jobId = job?.job_id;

// Real payments (MOCK_PAYMENTS=false): request_human returns a Stripe Checkout URL and the job waits in
// `requested` until the customer pays, so the agent/worker flow below can't run unattended. Check the
// payment hand-off, the read/cancel paths and the guardrails instead.
if (job?.escrow_url) {
  await check("escrow_url is a Stripe Checkout link", async () => job.escrow_url, (u) => /^https:\/\/checkout\.stripe\.com\//.test(u) || `got ${u}`);
  await check("get_job (awaiting payment)", () => pub.call("get_job", { job_id: jobId }), (r) => r.status === "requested" || `status ${r.status}`);
  await check("cancel_job (unpaid)", () => pub.call("cancel_job", { job_id: jobId }), (r) => r.status === "cancelled" || JSON.stringify(r));
  await check("ledger (real)", () => internal.call("ledger", {}), (r) => typeof r.revenue_usd === "number" || "bad shape");
  await check("safety filter", () => pub.call("request_human", { title: "Get a code", instructions: "Receive an SMS verification code and send it to me", location: loc,
    deadline: new Date(Date.now() + 3 * 3600e3).toISOString(), budget_usd: 25, certification_required: null, proof: { geofence_m: 150 } }), (r) => r.status === "rejected" || "not rejected");
  await check("geofence", () => pub.call("request_human", { title: "LA photo", instructions: "Photo of a sign", location: { address: "LA", lat: 34.05, lng: -118.24 },
    deadline: new Date(Date.now() + 3 * 3600e3).toISOString(), budget_usd: 25, certification_required: null, proof: { geofence_m: 150 } }), (r) => r.status === "rejected" || "not rejected");
  await check("internal auth", () => fetch(`${API}/mcp/internal`, { method: "POST" }).then((r) => r.status), (s) => s === 401 || `got ${s}`);
  const pass = results.filter((r) => r.ok).length;
  for (const r of results) console.log(`${r.ok ? "✅" : "❌"} ${r.tool}${r.note ? "  — " + r.note : ""}`);
  console.log(`\n${pass}/${results.length} passed  (real payments mode; job ${jobId})`);
  await sql.end(); await pub.client.close(); await internal.client.close();
  process.exit(pass === results.length ? 0 : 1);
}

await check("get_job", () => pub.call("get_job", { job_id: jobId }), (r) => r.status === "held" || `status ${r.status}`);
const people = await check("find_people", () => internal.call("find_people", { job_id: jobId, limit: 2 }), (r) => r.candidates?.length > 0 || "no candidates");
await check("send_blast", () => internal.call("send_blast", { job_id: jobId, candidate_ids: people?.candidates.map((c: any) => c.candidate_id) ?? [] }), (r) => r.sent > 0 || "sent 0");

// play the worker over REST (what Dora's pages call)
const [o] = await sql`select token from outreach where job_id = ${jobId} order by created_at limit 1`;
await check("worker GET job page", () => fetch(`${API}/v1/worker/jobs/${o?.token}`).then((r) => r.json()), (r) => r.can_accept === true || JSON.stringify(r));
await check("worker accept", () => fetch(`${API}/v1/worker/jobs/${o?.token}/accept`, { method: "POST" }).then((r) => r.json()), (r) =>
  r.ok === true || (JSON.stringify(r).includes("identity_not_verified") ? "identity_not_verified: run the API with IDENTITY_GATE=log for smoke (its worker has no Stripe Identity)" : JSON.stringify(r)));
await check("worker proof", () => fetch(`${API}/v1/worker/jobs/${o?.token}/proof`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ media: [{ url: "https://picsum.photos/seed/a/800", kind: "image/jpeg" }, { url: "https://picsum.photos/seed/b/800", kind: "image/jpeg" }],
    gps_lat: loc.lat + 0.0003, gps_lng: loc.lng, captured_at: new Date().toISOString() }),
}).then((r) => r.json()), (r) => r.ok === true || JSON.stringify(r));

const cp = await check("check_proof", () => internal.call("check_proof", { job_id: jobId }), (r) => typeof r.overall_score === "number" || "no score");
await check("approve_proof", () => internal.call("approve_proof", { job_id: jobId, proof_id: cp?.proof_id, notes: "smoke" }), (r) => r.status === "approved" || JSON.stringify(r));
await check("capture_payment", () => internal.call("capture_payment", { job_id: jobId }), (r) => r.captured_usd === 40 || JSON.stringify(r));
await check("payout", () => internal.call("payout", { job_id: jobId }), (r) => r.status === "paid" || JSON.stringify(r));
await check("ledger", () => internal.call("ledger", {}), (r) => typeof r.revenue_usd === "number" || "bad shape");
await check("get_job (internal, paid)", () => internal.call("get_job", { job_id: jobId }), (r) => (r.status === "paid" && r.proof_package?.media_urls?.length === 2) || `status ${r.status}`);

// cancel path + escalate path on a second job
const j2 = await pub.call("request_human", { title: "Smoke 2", instructions: "Photo of a door.", location: loc,
  deadline: new Date(Date.now() + 3 * 3600e3).toISOString(), budget_usd: 25, certification_required: null, proof: { geofence_m: 150 } });
await check("cancel_job", () => pub.call("cancel_job", { job_id: j2.job_id }), (r) => r.status === "cancelled" || JSON.stringify(r));
await check("escalate (bad state → refused)", () => internal.call("escalate", { job_id: j2.job_id, proof_id: "00000000-0000-0000-0000-000000000000", reason: "smoke" }).then(() => "should have failed", (e) => (e.message.includes("cannot move") ? "refused" : e.message)), (r) => r === "refused" || r);
await check("refund (paid → refunded)", () => internal.call("refund", { job_id: jobId, reason: "smoke" }), (r) => r.status === "refunded" || JSON.stringify(r));
await check("safety filter", () => pub.call("request_human", { title: "Get a code", instructions: "Receive an SMS verification code and send it to me", location: loc,
  deadline: new Date(Date.now() + 3 * 3600e3).toISOString(), budget_usd: 25, certification_required: null, proof: { geofence_m: 150 } }), (r) => r.status === "rejected" || "not rejected");
await check("geofence", () => pub.call("request_human", { title: "LA photo", instructions: "Photo of a sign", location: { address: "LA", lat: 34.05, lng: -118.24 },
  deadline: new Date(Date.now() + 3 * 3600e3).toISOString(), budget_usd: 25, certification_required: null, proof: { geofence_m: 150 } }), (r) => r.status === "rejected" || "not rejected");
await check("internal auth", () => fetch(`${API}/mcp/internal`, { method: "POST" }).then((r) => r.status), (s) => s === 401 || `got ${s}`);

const wakes = await sql`select event from wake_events where job_id = ${jobId} order by created_at`;
await check("wake timeline", async () => wakes.map((w) => w.event).join(","), (s) => s === "held,accepted,proof_submitted,approved" || `got ${s}`);

const pass = results.filter((r) => r.ok).length;
for (const r of results) console.log(`${r.ok ? "✅" : "❌"} ${r.tool}${r.note ? "  — " + r.note : ""}`);
console.log(`\n${pass}/${results.length} passed  (job ${jobId})`);
await sql`delete from customers where id = ${cust.id} and false`; // keep for inspection
await sql.end();
await pub.client.close(); await internal.client.close();
process.exit(pass === results.length ? 0 : 1);
