// Founder console: escalated proofs to approve/reject, headline numbers, recent jobs.
// Open /admin?key=ADMIN_KEY once; the key is remembered in this browser.
"use client";
import { useEffect, useState } from "react";

const card: React.CSSProperties = { background: "#fff", borderRadius: 14, padding: 18, boxShadow: "0 1px 3px rgba(0,0,0,.08)", marginBottom: 14 };
const btn = (bg: string): React.CSSProperties => ({ background: bg, color: "#fff", border: 0, borderRadius: 10, padding: "10px 16px", fontWeight: 600, cursor: "pointer", marginRight: 8 });

export default function Admin() {
  const [key, setKey] = useState("");
  const [data, setData] = useState<any>(null);
  const [dash, setDash] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [approvals, setApprovals] = useState<any[] | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(location.search).get("key");
    if (q) { localStorage.setItem("operis_admin", q); history.replaceState(null, "", "/admin"); }
    setKey(q ?? localStorage.getItem("operis_admin") ?? "");
  }, []);

  const H = () => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" });
  const load = async () => {
    if (!key) return;
    const [a, b] = await Promise.all([fetch("/v1/admin/escalations", { headers: H() }), fetch("/v1/dashboard", { headers: H() })]);
    if (a.status === 401) { setErr("Wrong or missing admin key. Open /admin?key=YOUR_ADMIN_KEY"); return; }
    setErr(""); setData(await a.json()); setDash(await b.json());
    fetch("/v1/admin/approvals", { headers: H() }).then((r) => r.json()).then((j) => setApprovals(j.items ?? [])).catch(() => {});
  };
  const approve = async (p: any, decision: "allow" | "deny", scope: "call" | "session") => {
    setBusy(p.tool_call_id);
    const r = await fetch("/v1/admin/approvals", { method: "POST", headers: H(), body: JSON.stringify({ session_id: p.session_id, tool_call_id: p.tool_call_id, decision, scope }) });
    if (!r.ok) alert(`failed (${r.status})`);
    setBusy(""); load();
  };
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [key]);

  const decide = async (jobId: string, decision: "approve" | "reject") => {
    const note = decision === "reject" ? prompt("Reason for rejecting (sent to the record):") ?? "" : "";
    setBusy(jobId);
    const r = await fetch(`/v1/admin/escalations/${jobId}`, { method: "POST", headers: H(), body: JSON.stringify({ decision, note }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) alert(j.error ?? `failed (${r.status})`);
    setBusy(""); load();
  };

  return (
    <main style={{ fontFamily: "ui-sans-serif, system-ui", background: "#f5f5f7", minHeight: "100vh", padding: 20 }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ fontWeight: 800, letterSpacing: 2 }}>OPERIS · FOUNDER CONSOLE</div>
        {!key && <div style={card}>Open <code>/admin?key=YOUR_ADMIN_KEY</code> to sign in.</div>}
        {err && <div style={{ ...card, color: "#b00" }}>{err}</div>}
        {dash && (
          <div style={{ display: "flex", gap: 12, margin: "14px 0", flexWrap: "wrap" }}>
            {[["Open jobs", data?.counts?.open], ["Paid jobs", data?.counts?.paid], ["Needs review", data?.counts?.escalated],
              ["Revenue", `$${(dash.money?.revenue ?? 0).toFixed(2)}`], ["Fees", `$${(dash.money?.fees ?? 0).toFixed(2)}`], ["Paid out", `$${(dash.money?.payouts ?? 0).toFixed(2)}`]]
              .map(([k, v]) => (<div key={k as string} style={{ ...card, flex: "1 1 120px", marginBottom: 0 }}><div style={{ fontSize: 12, color: "#666" }}>{k}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{v ?? "–"}</div></div>))}
          </div>
        )}

        <h2 style={{ fontSize: 18 }}>Agent approvals ({approvals?.length ?? "…"})</h2>
        {approvals?.length === 0 && <div style={card}>No agent is waiting on you.</div>}
        {approvals?.map((p: any) => (
          <div key={p.tool_call_id} style={card}>
            <div style={{ fontWeight: 700 }}>{p.agent} wants to run <code>{p.tool}</code></div>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#f4f4f5", padding: 10, borderRadius: 8, maxHeight: 160, overflow: "auto" }}>{JSON.stringify(p.args, null, 2)}</pre>
            <button disabled={busy === p.tool_call_id} style={btn("#0a7")} onClick={() => approve(p, "allow", "session")}>Approve for this session</button>
            <button disabled={busy === p.tool_call_id} style={btn("#335")} onClick={() => approve(p, "allow", "call")}>Approve once</button>
            <button disabled={busy === p.tool_call_id} style={btn("#b33")} onClick={() => approve(p, "deny", "call")}>Deny</button>
          </div>
        ))}

        <h2 style={{ fontSize: 18 }}>Needs your review ({data?.items?.length ?? 0})</h2>
        {data?.items?.length === 0 && <div style={card}>Nothing escalated. The Verifier is handling everything.</div>}
        {data?.items?.map((it: any) => (
          <div key={it.job_id} style={card}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{it.title}</div>
            <div style={{ color: "#555", margin: "4px 0 8px" }}>{it.address} · ${Number(it.budget_usd).toFixed(2)} · worker {it.worker_name ?? it.worker_email ?? "?"}</div>
            <div style={{ fontSize: 14 }}><b>Required:</b> {it.proof_requirement?.photos ? `${it.proof_requirement.photos.min}+ photos of ${it.proof_requirement.photos.must_show?.join(", ")}` : "see instructions"}, within {it.proof_requirement?.geofence_m ?? "?"} m</div>
            <div style={{ fontSize: 14 }}><b>Verifier:</b> score {it.verifier_score ?? "–"} · {it.verifier_notes ?? "no notes"}</div>
            <div style={{ fontSize: 14 }}><b>GPS:</b> {it.gps_lat != null ? `${Number(it.gps_lat).toFixed(5)}, ${Number(it.gps_lng).toFixed(5)}` : "missing"} · <b>taken:</b> {it.captured_at ? new Date(it.captured_at).toLocaleString() : "unknown"}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
              {(it.media ?? []).map((m: any) => (m.kind?.startsWith("image/")
                ? <a key={m.url} href={m.url} target="_blank"><img src={m.url} style={{ height: 140, borderRadius: 8, objectFit: "cover" }} /></a>
                : <a key={m.url} href={m.url} target="_blank">{m.name ?? m.kind}</a>))}
            </div>
            <button disabled={busy === it.job_id} style={btn("#0a7")} onClick={() => decide(it.job_id, "approve")}>Approve → pay worker</button>
            <button disabled={busy === it.job_id} style={btn("#b33")} onClick={() => decide(it.job_id, "reject")}>Reject → refund customer</button>
          </div>
        ))}

        <h2 style={{ fontSize: 18 }}>Recent jobs</h2>
        <div style={card}>
          {(dash?.jobs ?? []).map((j: any) => (
            <div key={j.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #eee", fontSize: 14 }}>
              <span>{j.title}</span><span style={{ color: "#555" }}>{j.status} · ${Number(j.budget_usd).toFixed(0)}</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
