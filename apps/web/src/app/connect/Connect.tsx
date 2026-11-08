"use client";

// OAuth consent page: an AI app (Claude, ChatGPT, Cursor...) wants to use Operis for you.
// New company → sign up here; existing company → paste your key. Then we send you back to the app.
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { LogoPill } from "@/components/SiteHeader";

const input: React.CSSProperties = { font: "inherit", padding: "13px 14px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", width: "100%" };

export default function Connect() {
  const q = useSearchParams();
  const params = Object.fromEntries(["client_id", "redirect_uri", "code_challenge", "state", "scope", "resource"].map((k) => [k, q.get(k) ?? undefined]));
  const [client, setClient] = useState<{ client_name: string; redirect_host: string } | null>(null);
  const [mode, setMode] = useState<"new" | "key">("new");
  const [form, setForm] = useState({ name: "", contact_email: "", description: "", api_key: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!params.client_id) return;
    fetch(`/api/oauth/client?client_id=${encodeURIComponent(params.client_id)}`).then(async (r) => (r.ok ? setClient(await r.json()) : setErr("This connection link is invalid. Start again from your AI app.")));
  }, [params.client_id]);

  if (!params.client_id || !params.redirect_uri || !params.code_challenge) {
    return (
      <main className="landing"><div style={{ padding: 16 }}><LogoPill /></div>
        <div className="shell"><div className="card stack"><h1>Connect to Operis</h1><p className="muted">Open this page from your AI app&apos;s &quot;connect&quot; button. Add <span className="mono">https://operis.live/mcp</span> as a connector or MCP server and it will bring you here.</p></div></div>
      </main>
    );
  }

  const approve = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const body = mode === "key" ? { ...params, api_key: form.api_key } : { ...params, name: form.name, contact_email: form.contact_email, description: form.description };
    const r = await fetch("/api/oauth/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.redirect) { setBusy(false); return setErr(j.error ?? `Something went wrong (${r.status}).`); }
    window.location.assign(j.redirect);
  };

  const deny = () => {
    const u = new URL(params.redirect_uri!); u.searchParams.set("error", "access_denied"); if (params.state) u.searchParams.set("state", params.state);
    window.location.assign(u.toString());
  };

  const app = client?.client_name ?? "An AI app";
  return (
    <main className="landing">
      <div style={{ padding: "16px 16px 0" }}><LogoPill /></div>
      <div className="shell" style={{ maxWidth: 520, paddingTop: 32 }}>
        <section className="card stack" style={{ padding: 24 }}>
          <span className="eyebrow">Connect</span>
          <h1>{app} wants to use Operis for you</h1>
          <p className="muted">It will be able to hire verified humans for real-world tasks on your company&apos;s behalf: create jobs, check them, and cancel them. You pay per job at a Stripe link, only when proof passes.{client?.redirect_host ? <> You&apos;ll go back to <span className="mono">{client.redirect_host}</span>.</> : null}</p>

          <div className="row" style={{ gap: 6 }}>
            {(["new", "key"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} className="pill" style={{ cursor: "pointer", border: 0, padding: "8px 14px", background: mode === m ? "var(--accent)" : "var(--surface-2)", color: mode === m ? "var(--accent-text)" : "var(--muted)" }}>
                {m === "new" ? "New to Operis" : "I have an API key"}
              </button>
            ))}
          </div>

          <form onSubmit={approve} className="stack">
            {mode === "new" ? (
              <>
                <input style={input} required minLength={2} placeholder="Company or agent name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <input style={input} required type="email" placeholder="Your email (receipts, anything urgent)" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
                <input style={input} placeholder="What does your agent do? (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </>
            ) : (
              <input style={input} required placeholder="opk_…" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
            )}
            {err && <div className="notice bad">{err}</div>}
            <button className="btn" disabled={busy}>{busy ? "Connecting…" : `Allow ${app}`}</button>
            <button type="button" className="btn ghost" onClick={deny}>Cancel</button>
          </form>
          <p className="small muted">The app gets its own key for your company, separate from any you&apos;ve made. Rules: no CAPTCHAs, codes, account logins, impersonation, surveillance or signing anything. See <a href="/llms.txt">what Operis does</a>.</p>
        </section>
      </div>
    </main>
  );
}
