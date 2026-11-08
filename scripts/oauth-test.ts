// End-to-end MCP OAuth check, the way an MCP client does it.
//   npx tsx scripts/oauth-test.ts [base]     (default http://localhost:3100; production: https://operis.live)
import { createHash, randomBytes } from "node:crypto";
const BASE = (process.argv[2] ?? "http://localhost:3100").replace(/\/$/, "");
const ok = (c: boolean, m: string) => { console.log(`${c ? "✅" : "❌"} ${m}`); if (!c) process.exitCode = 1; return c; };

// 1. unauthenticated MCP call → 401 + WWW-Authenticate
const r401 = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
const www = r401.headers.get("www-authenticate") ?? "";
ok(r401.status === 401 && www.includes("resource_metadata="), `401 with WWW-Authenticate (${www.slice(0, 90)})`);
const metaUrl = www.match(/resource_metadata="([^"]+)"/)?.[1] ?? `${BASE}/.well-known/oauth-protected-resource`;

// 2. discovery
const prm = await (await fetch(metaUrl)).json();
ok(!!prm.authorization_servers?.length, `resource metadata: resource=${prm.resource} as=${prm.authorization_servers}`);
const asm = await (await fetch(`${prm.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json();
ok(!!asm.registration_endpoint && asm.code_challenge_methods_supported?.includes("S256"), `AS metadata: issuer=${asm.issuer}`);

// 3. dynamic client registration
const redirect = "http://localhost:53682/callback";
const reg = await (await fetch(asm.registration_endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Operis OAuth test", redirect_uris: [redirect] }) })).json();
ok(!!reg.client_id, `registered client ${reg.client_id}`);

// 4. authorize → consent page
const verifier = randomBytes(48).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(8).toString("hex");
const authUrl = `${asm.authorization_endpoint}?response_type=code&client_id=${reg.client_id}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256&state=${state}&scope=operis`;
const az = await fetch(authUrl, { redirect: "manual" });
const loc = az.headers.get("location") ?? "";
ok(az.status === 302 && loc.includes("/connect?"), `authorize → ${loc.slice(0, 80)}…`);

// 5. the human approves on /connect (what the page POSTs)
const cp = new URL(loc);
const ap = await fetch(`${BASE}/api/oauth/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
  ...Object.fromEntries(cp.searchParams), name: `OAuth Test Co ${Date.now() % 10000}`, contact_email: "oauth-test@operis.dev" }) });
const apj = await ap.json();
const back = new URL(apj.redirect ?? "http://x/");
ok(back.searchParams.get("state") === state && !!back.searchParams.get("code"), `approve → redirect with code + state`);

// 6. token exchange (form-encoded, PKCE)
const tk = await (await fetch(asm.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code")!, redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier }) })).json();
ok(tk.access_token?.startsWith("opk_") && !!tk.refresh_token, `token: ${tk.token_type} ${String(tk.access_token).slice(0, 8)}… + refresh`);
const reuse = await (await fetch(asm.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code")!, redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier }) })).json();
ok(reuse.error === "invalid_grant", "code can't be reused");

// 7. MCP with the access token
const tl = await (await fetch(`${BASE}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${tk.access_token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) })).json();
ok(tl.result?.tools?.length === 3, `tools/list with OAuth token: ${tl.result?.tools?.map((t: any) => t.name).join(", ")}`);

// 8. refresh
const rf = await (await fetch(asm.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tk.refresh_token, client_id: reg.client_id }) })).json();
ok(rf.access_token?.startsWith("opk_") && rf.access_token !== tk.access_token, "refresh → new access token");
