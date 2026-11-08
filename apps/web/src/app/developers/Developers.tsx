"use client";

// For agent companies: self-serve an API key, connect your agent, copy the prompt, test it.
// Same look as the rest of the site (paper cards inside the forest frame).
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { LogoPill } from "@/components/SiteHeader";
import { agentPrompt } from "@/lib/agentPrompt";

type Created = { customer_id: string; api_key: string; mcp_url: string };
type Tab = "prompt" | "claude" | "json" | "naive" | "curl";

const PUBLIC_MCP = process.env.NEXT_PUBLIC_MCP_URL ?? "";

function CopyBlock({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <pre className="mono" style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#17211a", color: "#e9e5dc", padding: "16px 16px 16px", borderRadius: 12, fontSize: 12.5, lineHeight: 1.6, maxHeight: 420, overflow: "auto" }}>{text}</pre>
      <button
        type="button"
        onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600); }}
        style={{ position: "absolute", top: 10, right: 10, border: 0, borderRadius: 8, padding: "6px 12px", background: done ? "#a9c0a2" : "#46664f", color: done ? "#17211a" : "#f7f4ee", fontWeight: 600, cursor: "pointer", fontSize: 13 }}
      >
        {done ? "Copied" : label}
      </button>
    </div>
  );
}

function Step({ n, title, children, done }: { n: number; title: string; children: React.ReactNode; done?: boolean }) {
  return (
    <section className="card stack" style={{ padding: 22 }}>
      <div className="row" style={{ gap: 12 }}>
        <span style={{ width: 30, height: 30, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", background: done ? "var(--accent)" : "var(--accent-soft)", color: done ? "var(--accent-text)" : "var(--accent-ink)", fontWeight: 700, fontSize: 14 }}>{done ? "✓" : n}</span>
        <h2 style={{ fontSize: "1.25rem" }}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default function Developers() {
  const [mcpUrl, setMcpUrl] = useState(PUBLIC_MCP);
  const [form, setForm] = useState({ name: "", contact_email: "", description: "" });
  const [created, setCreated] = useState<Created | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("prompt");
  const [test, setTest] = useState<{ state: "idle" | "running" | "ok" | "fail"; tools?: string[]; msg?: string }>({ state: "idle" });

  useEffect(() => {
    // Default to this site's API through the proxy origin if no public MCP URL is configured.
    if (!PUBLIC_MCP) setMcpUrl(`${window.location.origin}/api/mcp`);
    const saved = sessionStorage.getItem("operis_new_key");
    if (saved) setCreated(JSON.parse(saved));
  }, []);

  const key = created?.api_key ?? "<YOUR_OPERIS_KEY>";
  const url = created?.mcp_url && PUBLIC_MCP ? created.mcp_url : mcpUrl;
  const snippets = useMemo<Record<Tab, string>>(() => ({
    prompt: agentPrompt(url, key),
    claude: `claude mcp add --transport http operis ${url} --header "Authorization: Bearer ${key}"`,
    json: JSON.stringify({ mcpServers: { operis: { type: "http", url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2),
    naive: `# 1. store the key in a Naïve vault, bound to the Operis MCP URL
POST https://api.vetta.sh/v1/vaults/{vault_id}/credentials
{ "kind": "static_bearer", "key": "operis", "mcp_server_url": "${url}", "value": "${key}" }

# 2. give your agent the server and the tool
PATCH https://api.vetta.sh/v1/agents/{agent_id}
{ "expected_version": N,
  "mcp_servers": [{ "name": "operis", "url": "${url}" }],
  "tools": { "default_config": { "permission": "allow" },
             "configs": { "operis.request_human": { "enabled": true, "permission": "allow" },
                          "operis.get_job": { "enabled": true, "permission": "allow" } } } }`,
    curl: `curl -s -X POST ${url} \\
  -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"request_human","arguments":{
    "title":"Photograph the storefront and posted hours",
    "instructions":"Stand across the street. One photo of the full storefront, one close-up of the hours sign.",
    "location":{"address":"2102 Union St, San Francisco, CA","lat":37.797,"lng":-122.433},
    "deadline":"${new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 16)}:00Z","budget_usd":30,"certification_required":null,
    "proof":{"photos":{"min":2,"must_show":["storefront","hours sign"]},"geofence_m":150}}}}'`,
  }), [url, key]);

  const signup = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await fetch("/api/v1/customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? `Something went wrong (${r.status}).`);
    const c = { customer_id: j.customer_id, api_key: j.api_key, mcp_url: j.mcp_url };
    setCreated(c);
    sessionStorage.setItem("operis_new_key", JSON.stringify(c));
  };

  const runTest = async () => {
    if (!created) return;
    setTest({ state: "running" });
    try {
      const r = await fetch("/api/mcp", {
        method: "POST",
        headers: { Authorization: `Bearer ${created.api_key}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      const j = await r.json();
      const tools = (j.result?.tools ?? []).map((t: { name: string }) => t.name);
      setTest(tools.length ? { state: "ok", tools } : { state: "fail", msg: j.error ?? `HTTP ${r.status}` });
    } catch (e) {
      setTest({ state: "fail", msg: String(e) });
    }
  };

  const tabs: [Tab, string][] = [["prompt", "Prompt for your agent"], ["claude", "Claude Code"], ["json", "Cursor / Claude Desktop"], ["naive", "Naïve agent"], ["curl", "curl"]];

  return (
    <main className="landing">
      <div style={{ padding: "16px 16px 0", maxWidth: 1100, width: "100%", margin: "0 auto" }}>
        <LogoPill />
      </div>

      <div style={{ maxWidth: 1100, width: "100%", margin: "0 auto", padding: "40px 16px 96px", display: "grid", gap: 18 }}>
        <header className="stack" style={{ gap: 14, marginBottom: 10 }}>
          <span className="eyebrow">For agent companies</span>
          <h1 className="display" style={{ fontSize: "clamp(36px, 6vw, 64px)" }}>Give your agent a verified human.</h1>
          <p className="lede">
            One MCP tool, <span className="mono">request_human</span>. A vetted person in San Francisco photographs, picks up, ships or
            delivers paperwork, and you get geotagged proof. Get a key in ten seconds and paste one prompt into your agent.
          </p>
        </header>

        <Step n={1} title="Get your API key" done={!!created}>
          {!created ? (
            <form onSubmit={signup} className="stack" style={{ maxWidth: 560 }}>
              <label className="stack" style={{ gap: 6 }}>
                <span className="small muted">Company or agent name</span>
                <input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme Autonomous Store" style={inputStyle} />
              </label>
              <label className="stack" style={{ gap: 6 }}>
                <span className="small muted">Contact email (receipts and anything urgent)</span>
                <input required type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} placeholder="ops@acme.ai" style={inputStyle} />
              </label>
              <label className="stack" style={{ gap: 6 }}>
                <span className="small muted">What does your agent do? (optional)</span>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Runs our e-commerce store" style={inputStyle} />
              </label>
              {err && <div className="notice bad">{err}</div>}
              <button className="btn" disabled={busy} style={{ maxWidth: 260 }}>{busy ? "Creating…" : "Create my key"}</button>
            </form>
          ) : (
            <div className="stack">
              <div className="notice good"><strong>Your key is ready.</strong> Copy it now; we only store a hash, so it can&apos;t be shown again.</div>
              <CopyBlock text={created.api_key} label="Copy key" />
              <div className="small muted">MCP server: <span className="mono">{url}</span></div>
            </div>
          )}
        </Step>

        <Step n={2} title="Connect your agent">
          <p className="muted">Pick how your agent runs. Your key is already filled in{created ? "" : " once you create it"}.</p>
          <div className="row wrap" style={{ gap: 6 }}>
            {tabs.map(([t, label]) => (
              <button key={t} type="button" onClick={() => setTab(t)} className="pill" style={{ cursor: "pointer", border: 0, padding: "8px 14px", fontSize: 13, background: tab === t ? "var(--accent)" : "var(--surface-2)", color: tab === t ? "var(--accent-text)" : "var(--muted)" }}>{label}</button>
            ))}
          </div>
          {tab === "prompt" && <p className="small muted">Paste this into your agent&apos;s system prompt, CLAUDE.md, or skill file. It tells the agent when and how to hire a human, what to expect back, and what&apos;s not allowed.</p>}
          <CopyBlock text={snippets[tab]} />
        </Step>

        <Step n={3} title="Check the connection" done={test.state === "ok"}>
          <p className="muted">We call the MCP server with your key and list the tools your agent will see.</p>
          <div className="row wrap" style={{ gap: 10 }}>
            <button className="btn secondary" style={{ maxWidth: 240 }} disabled={!created || test.state === "running"} onClick={runTest}>{test.state === "running" ? "Checking…" : "Test my key"}</button>
            {test.state === "ok" && <span className="pill good">Connected · {test.tools?.join(", ")}</span>}
            {test.state === "fail" && <span className="pill bad">Failed: {test.msg}</span>}
            {!created && <span className="small muted">Create a key first.</span>}
          </div>
        </Step>

        <Step n={4} title="Ask your agent to hire someone">
          <p className="muted">Try a prompt like this in your agent:</p>
          <CopyBlock text={`Use Operis to hire a human to photograph the storefront and posted opening hours at 2102 Union St, San Francisco (37.797, -122.433). Two photos, within 150 m, budget $30, done within 4 hours. Then check the job status and tell me when the proof is in.`} />
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
            <li>You pay only when the proof passes. Budget is the total; the worker gets 75%.</li>
            <li>Payment: if the result has an <span className="mono">escrow_url</span>, your human pays it once; otherwise the job is already funded.</li>
            <li>Limits: 3 open jobs and 10 per day per key. Email us for more.</li>
            <li>Full reference for agents: <Link href="/api/llms.txt">/llms.txt</Link></li>
          </ul>
        </Step>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  font: "inherit", padding: "14px 14px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)",
};
