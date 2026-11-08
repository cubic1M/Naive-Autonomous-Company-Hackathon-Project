"use client";

// Light backoffice: requests trickling in from different companies' agents, live.
// Admin key is asked once and kept in this browser (localStorage "operis_admin", shared with /admin on the API).
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { Logo } from "@/components/Icon";
import { ago, usd } from "@/lib/format";

const POLL_MS = 3000;
const HAPPY = ["requested", "held", "outreach", "accepted", "proof_submitted", "approved", "paid"];
const LABEL: Record<string, string> = {
  requested: "Awaiting payment", held: "Funded", outreach: "Finding people", accepted: "Worker on it",
  proof_submitted: "Proof in", approved: "Approved", paid: "Paid", escalated: "Needs review",
  rejected: "Rejected", cancelled: "Cancelled", expired: "Expired", refunded: "Refunded",
};
const AGENT_TONE: Record<string, string> = { ceo: "good", ops: "info", verifier: "warn", finance: "good", sales: "" };
const TONE: Record<string, string> = {
  paid: "good", approved: "good", escalated: "warn", rejected: "bad", expired: "bad", refunded: "info", cancelled: "",
};

type Req = {
  id: string; title: string; instructions: string; status: string; address: string; lat: number | null; lng: number | null;
  deadline: string; budget_usd: string; fee_usd: string; created_at: string; updated_at: string;
  company: string | null; contact_email: string | null; worker_name: string | null; invited: number;
  wakes: { event: string; at: string; session: string | null }[] | null;
  proof: { media: { url: string; kind: string }[] | null; score: number | null; status: string; notes: string | null } | null;
  activity: { agent: string; type: string; summary: string; at: string }[] | null;
};
type FeedItem = { agent: string; type: string; summary: string; job_id: string | null; created_at: string };
type Data = {
  now: string;
  stats: { today: number; open: number; paid: number; escalated: number; companies: number };
  companies: { id: string; name: string; requests: number; paid: number; spend: number; last_request_at: string | null }[];
  requests: Req[];
  feed: FeedItem[];
};

export default function Backoffice() {
  const [key, setKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [live, setLive] = useState(true);
  const [authErr, setAuthErr] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [company, setCompany] = useState<string>("all");
  const [, tick] = useState(0);
  const seen = useRef<Map<string, string>>(new Map());
  const first = useRef(true);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => setKey(localStorage.getItem("operis_admin")), []);

  const poll = useCallback(async () => {
    if (!key) return;
    try {
      const r = await fetch("/api/v1/admin/requests?limit=150", { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
      if (r.status === 401) { setAuthErr(true); return; }
      const j: Data = await r.json();
      // flash rows that are new or changed state since the last poll
      const f = new Set<string>();
      for (const q of j.requests) {
        const prev = seen.current.get(q.id);
        if (!first.current && prev !== q.status) f.add(q.id);
        seen.current.set(q.id, q.status);
      }
      first.current = false;
      setFresh(f); setData(j); setLive(true); setAuthErr(false);
    } catch { setLive(false); }
  }, [key]);

  useEffect(() => {
    if (!key) return;
    let alive = true; let t: ReturnType<typeof setTimeout>;
    const loop = async () => { await poll(); if (alive) t = setTimeout(loop, document.hidden ? POLL_MS * 4 : POLL_MS); };
    loop();
    const clock = setInterval(() => tick((n) => n + 1), 5000);
    return () => { alive = false; clearTimeout(t); clearInterval(clock); };
  }, [key, poll]);

  if (!key || authErr) {
    return (
      <main className="dash" style={{ maxWidth: 520 }}>
        <span className="brand"><Logo /> operis. backoffice</span>
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); localStorage.setItem("operis_admin", draft.trim()); setKey(draft.trim()); setAuthErr(false); first.current = true; }}>
          <h1>Founders only</h1>
          {authErr && <div className="notice bad">That admin key didn&apos;t work.</div>}
          <input type="password" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="ADMIN_KEY" autoFocus
            style={{ font: "inherit", padding: 14, borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface)" }} />
          <button className="btn">Open backoffice</button>
        </form>
      </main>
    );
  }

  const reqs = (data?.requests ?? []).filter((q) => q.company !== "smoke-test" && (company === "all" || q.company === company));
  const s = data?.stats;

  return (
    <main className="dash">
      <header className="row between wrap">
        <span className="brand"><Logo /> operis. backoffice</span>
        <div className="row small muted" style={{ gap: 10 }}>
          <span className={`live-dot ${live ? "" : "off"}`} aria-hidden />
          {live ? "Live" : "Reconnecting…"}
          <button className="pill" style={{ border: 0, cursor: "pointer" }} onClick={() => { localStorage.removeItem("operis_admin"); setKey(null); }}>Sign out</button>
        </div>
      </header>

      <section className="tiles">
        <Tile k="Requests · 24h" v={s?.today ?? "–"} />
        <Tile k="In progress" v={s?.open ?? "–"} />
        <Tile k="Paid" v={s?.paid ?? "–"} />
        <Tile k="Companies" v={s?.companies ?? "–"} />
      </section>

      {!!s?.escalated && <div className="notice warn"><strong>{s.escalated} proof{s.escalated > 1 ? "s" : ""} need a founder decision.</strong> Review them in the founder console on the API (/admin).</div>}

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0, 1fr)", alignItems: "start" }} className="bo-grid">
        <section className="card stack">
          <div className="row between wrap">
            <h2>Incoming requests</h2>
            <select value={company} onChange={(e) => setCompany(e.target.value)} style={{ font: "inherit", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)" }}>
              <option value="all">All companies</option>
              {(data?.companies ?? []).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>When</th><th>Company</th><th>Request</th><th>Where</th><th className="num">Budget</th><th>Status</th></tr></thead>
              <tbody>
                {reqs.length === 0 && <tr><td colSpan={6} className="muted">No requests yet. Share <span className="mono">/developers</span> with agent companies.</td></tr>}
                {reqs.map((q) => (
                  <Fragment key={q.id}>
                    <tr onClick={() => setOpen(open === q.id ? null : q.id)} style={{ cursor: "pointer", animation: fresh.has(q.id) ? "flash 1.6s ease-out" : undefined }}>
                      <td className="small muted" style={{ whiteSpace: "nowrap" }}>{ago(q.created_at)}</td>
                      <td><strong>{q.company ?? "?"}</strong></td>
                      <td>{q.title}</td>
                      <td className="small muted">{q.lat == null ? "Remote" : q.address}</td>
                      <td className="num">{usd(Number(q.budget_usd))}</td>
                      <td><span className={`pill ${TONE[q.status] ?? "info"}`}>{LABEL[q.status] ?? q.status}</span></td>
                    </tr>
                    {open === q.id && (
                      <tr><td colSpan={6} style={{ background: "var(--surface-2)" }}><Detail q={q} /></td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="stack">
        <section className="card stack">
          <div className="row between"><h2>Agent activity</h2><span className="small muted">5 Naïve agents</span></div>
          <ul className="feed" style={{ maxHeight: 420 }}>
            {(data?.feed ?? []).length === 0 && <li className="muted small">No agent activity yet. It appears here within a minute of a job being funded.</li>}
            {(data?.feed ?? []).map((f, i) => (
              <li key={`${f.created_at}-${i}`}>
                <div className="row between"><span className={`pill ${AGENT_TONE[f.agent] ?? ""}`}>{f.agent}</span><span className="small muted">{ago(f.created_at)}</span></div>
                <div className="small" style={{ wordBreak: "break-word" }}>{f.summary.replace(new RegExp(`^${f.agent}\\s*`), "")}</div>
              </li>
            ))}
          </ul>
        </section>
        <section className="card stack">
          <h2>Companies</h2>
          <ul className="feed">
            {(data?.companies ?? []).length === 0 && <li className="muted small">No companies have signed up yet.</li>}
            {(data?.companies ?? []).map((c) => (
              <li key={c.id}>
                <div className="row between"><strong>{c.name}</strong><span className="small muted">{c.last_request_at ? ago(c.last_request_at) : "no requests"}</span></div>
                <div className="small muted">{c.requests} request{c.requests === 1 ? "" : "s"} · {c.paid} paid · {usd(c.spend)} spent</div>
              </li>
            ))}
          </ul>
        </section>
        </div>
      </div>
      <style>{`@media (min-width: 1000px) { .bo-grid { grid-template-columns: minmax(0, 2.2fr) minmax(0, 1fr) !important; } }`}</style>
    </main>
  );
}

function Detail({ q }: { q: Req }) {
  const at = HAPPY.indexOf(q.status);
  return (
    <div className="stack" style={{ padding: "6px 2px" }}>
      <div className="pipeline">
        {HAPPY.map((st, i) => <span key={st} className={i < at ? "done" : i === at ? "now" : ""}>{LABEL[st]}</span>)}
        {at === -1 && <span className="alt">{LABEL[q.status] ?? q.status}</span>}
      </div>
      <p className="small pre">{q.instructions}</p>
      <div className="small muted">
        Deadline {new Date(q.deadline).toLocaleString()} · {q.invited} people invited{q.worker_name ? ` · worker: ${q.worker_name}` : ""} · contact {q.contact_email ?? "?"}
      </div>
      {!!q.wakes?.length && (
        <div className="small"><span className="eyebrow">Agents woken</span>{" "}
          {q.wakes.map((w) => <span key={w.event} className="pill" style={{ marginRight: 6 }}>{w.event.replace("_", " ")} · {ago(w.at)}</span>)}
        </div>
      )}
      {!!q.activity?.length && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">What the agents did</span>
          {q.activity.map((a, i) => (
            <div key={i} className="small" style={{ display: "grid", gridTemplateColumns: "90px 1fr 70px", gap: 8 }}>
              <span className={`pill ${AGENT_TONE[a.agent] ?? ""}`} style={{ justifySelf: "start" }}>{a.agent}</span>
              <span style={{ wordBreak: "break-word" }}>{a.summary.replace(new RegExp(`^${a.agent}\\s*`), "")}</span>
              <span className="muted">{ago(a.at)}</span>
            </div>
          ))}
        </div>
      )}
      {q.proof && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="small"><span className="eyebrow">Proof</span> {q.proof.status} · verifier score {q.proof.score ?? "–"}{q.proof.notes ? ` · ${q.proof.notes}` : ""}</div>
          <div className="row wrap">
            {(q.proof.media ?? []).map((m) => m.kind?.startsWith("image/")
              // eslint-disable-next-line @next/next/no-img-element
              ? <a key={m.url} href={m.url} target="_blank" rel="noreferrer"><img src={m.url} alt="" style={{ height: 96, borderRadius: 8, objectFit: "cover" }} /></a>
              : <a key={m.url} href={m.url} target="_blank" rel="noreferrer" className="small">{m.kind}</a>)}
          </div>
        </div>
      )}
      <div className="small muted mono">job {q.id}</div>
    </div>
  );
}

function Tile({ k, v }: { k: string; v: string | number }) {
  return <div className="card tile"><div className="k">{k}</div><div className="v">{v}</div></div>;
}
