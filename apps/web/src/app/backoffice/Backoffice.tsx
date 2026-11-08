"use client";

// Founders' backoffice (admin.operis.live). Same look as operis.live: warm paper, forest accents,
// Avenir throughout (globals.css --font), small caps labels, a dark ink panel for live agent activity.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Logo } from "@/components/SiteHeader";
import { Divider, GoogleButton } from "@/components/auth/ui";
import { ago, usd } from "@/lib/format";
import PasswordInput from "@/components/PasswordInput";

const POLL_MS = 3000;

// Fixed palette, like the launch page (doesn't follow system dark mode).
const C = {
  paper: "#ECE8DF", card: "#FBF9F5", card2: "#F3EFE7", ink: "#17211A", inkCard: "#1F2A22", inkLine: "#2F3D33",
  border: "#DCD6CA", text: "#232824", heading: "#1F2A22", muted: "#5B635C", faint: "#8E958C",
  accent: "#46664F", accentSoft: "#E2EADE", accentInk: "#2F4A37", sage: "#A9C0A2",
  warn: "#8A5300", warnSoft: "#F6EAD3", bad: "#A12A22", badSoft: "#F6E1DE", info: "#3E5C5A", infoSoft: "#E2EBE8",
};
const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase" };
const display: React.CSSProperties = { fontFamily: "var(--font-display)", letterSpacing: "-0.035em", fontWeight: 500 };
const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 16 };
const btn: React.CSSProperties = { border: 0, borderRadius: 10, padding: "10px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "inherit" };

const FLOW = ["requested", "held", "outreach", "accepted", "proof_submitted", "approved", "paid"] as const;
const LABEL: Record<string, string> = {
  requested: "Awaiting payment", held: "Funded", outreach: "Finding people", accepted: "Worker on it",
  proof_submitted: "Proof in", approved: "Approved", paid: "Paid", escalated: "Needs review",
  rejected: "Rejected", cancelled: "Cancelled", expired: "Expired", refunded: "Refunded",
};
const DONE = new Set(["paid", "rejected", "cancelled", "expired", "refunded"]);
function tone(status: string): [string, string] {
  if (status === "paid" || status === "approved") return [C.accentSoft, C.accentInk];
  if (status === "escalated") return [C.warnSoft, C.warn];
  if (status === "rejected" || status === "expired") return [C.badSoft, C.bad];
  if (status === "cancelled" || status === "refunded" || status === "requested") return [C.card2, C.muted];
  return [C.infoSoft, C.info];
}
const AGENT_COLOR: Record<string, string> = { ceo: "#A9C0A2", ops: "#9EC3C0", verifier: "#E8C88A", finance: "#C9D8C3", sales: "#D8C3D3", disputes: "#E7A9A2", policy: "#8E958C" };

type Req = {
  id: string; title: string; instructions: string; status: string; address: string; lat: number | null; lng: number | null;
  deadline: string; budget_usd: string; fee_usd: string; worker_pay_usd: string; created_at: string; updated_at: string;
  company: string | null; contact_email: string | null; worker_name: string | null; invited: number;
  proof: { media: { url: string; kind: string }[] | null; score: number | null; status: string; notes: string | null } | null;
  activity: { agent: string; type: string; summary: string; at: string }[] | null;
};
type Feed = { agent: string | null; type: string; summary: string; job_id?: string | null; created_at?: string; at?: string };
type Data = {
  stats: { today: number; open: number; paid: number; escalated: number; companies: number };
  companies: { id: string; name: string; requests: number; paid: number; spend: number; last_request_at: string | null }[];
  requests: Req[]; feed: Feed[];
  money?: { revenue: number; payouts: number; fees: number; refunds: number; held: number };
  stages?: Record<string, number>;
  calls?: Call[];
  call_stats?: { total_24h: number; agents_24h: number; errors_24h: number; unauthorized_24h: number; request_human_24h: number };
};
type Call = {
  id: number; at: string; customer_id: string | null; customer_name: string | null; channel: string; method: string | null; tool: string | null;
  outcome: "ok" | "rejected" | "error" | "unauthorized"; http_status: number | null; duration_ms: number | null; job_id: string | null; summary: string | null; client: string | null;
};

// Raw tool events → readable lines.
const TOOL_WORDS: Record<string, string> = {
  "operis.get_job": "read the job", "operis.find_people": "searched for people", "operis.send_blast": "sent job offers",
  "operis.check_proof": "checked the proof", "operis.approve_proof": "approved the proof", "operis.escalate": "escalated to a founder",
  "operis.capture_payment": "captured the payment", "operis.payout": "paid the worker", "operis.refund": "refunded the customer",
  "operis.ledger": "checked the books", "operis.release_payout_large": "released a large payout", "operis.refund_large": "approved a large refund",
  "operis.get_proof_review": "read the proof review", "operis.get_dispute": "opened a dispute", "operis.submit_dispute_evidence": "drafted dispute evidence",
  board_read: "read the board", send_to_agent: "messaged a teammate", view_image: "looked at a photo", web_search: "searched the web",
  ask_operator: "asked a founder", "email.send": "sent an email", wait_for_agents: "waited for teammates", list_agents: "looked up the team",
};
type Line = { who: string; text: string; kind: "action" | "wait" | "say" | "auto"; at: string };
function humanize(f: Feed): Line | null {
  const at = f.created_at ?? f.at ?? new Date().toISOString();
  const s = f.summary ?? "";
  if (f.type === "approval") return { who: "policy", text: s.includes("auto-approved") ? "auto-approved a routine step" : s.replace(/^allow \((call|session)\): /, "approved: "), kind: "auto", at };
  const who = f.agent ?? "agent";
  const rest = s.startsWith(who) ? s.slice(who.length).trim() : s;
  if (f.type === "tool.confirm") return { who, text: `waiting for approval: ${(rest.split(":").pop() ?? "").trim()}`, kind: "wait", at };
  if (rest.startsWith("✓") || rest === "finished") return null; // completions are implied by the next action
  const m = rest.match(/^→\s*(\S+)\s*(.*)$/);
  if (m) {
    const [, tool, args] = m;
    if (tool === "board_write") {
      const op = args.match(/"op"\s*:\s*"(\w+)"/)?.[1] ?? "";
      const words: Record<string, string> = { create: "created a board card", assign: "assigned a card", comment: "commented on a card", update: "updated a card" };
      return { who, text: words[op] ?? "updated the board", kind: "action", at };
    }
    return { who, text: TOOL_WORDS[tool] ?? `used ${tool.replace("operis.", "")}`, kind: "action", at };
  }
  if (!rest.startsWith(":")) return rest ? { who, text: rest, kind: "action", at } : null;
  const said = rest.slice(1).replace(/\*\*/g, "").trim();
  return said ? { who, text: said, kind: "say", at } : null;
}

const GOOGLE_ERRORS: Record<string, string> = {
  not_a_founder: "That Google account isn't on the founders list.",
  google_cancelled: "Google sign-in was cancelled.",
  google_unavailable: "Google sign-in isn't switched on yet. Use your password.",
};

export default function Backoffice() {
  const [key, setKey] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [login, setLogin] = useState({ email: "", password: "" });
  const [loginErr, setLoginErr] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [authErr, setAuthErr] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [live, setLive] = useState(true);
  const [view, setView] = useState<"active" | "review" | "done" | "all">("active");
  const [company, setCompany] = useState("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Map<string, string>>(new Map());
  const first = useRef(true);
  const [, tick] = useState(0);

  useEffect(() => {
    // Back from "Continue with Google": the API puts the founder token in the URL fragment (never sent to a server).
    const h = new URLSearchParams(window.location.hash.slice(1));
    const t = h.get("admin_token"), e = h.get("email"), err = h.get("admin_error");
    if (t || err) history.replaceState(null, "", window.location.pathname + window.location.search);
    if (t && e) { localStorage.setItem("operis_admin", t); localStorage.setItem("operis_admin_email", e); }
    if (err) setLoginErr(GOOGLE_ERRORS[err] ?? "Google sign-in didn't go through. Please try again.");
    setKey(localStorage.getItem("operis_admin")); setMe(localStorage.getItem("operis_admin_email"));
  }, []);

  const poll = useCallback(async () => {
    if (!key) return;
    try {
      const r = await fetch("/api/v1/admin/requests?limit=200", { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
      if (r.status === 401) { setAuthErr(true); return; }
      const j: Data = await r.json();
      const f = new Set<string>();
      for (const x of j.requests) { const prev = seen.current.get(x.id); if (!first.current && prev !== x.status) f.add(x.id); seen.current.set(x.id, x.status); }
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

  const all = useMemo(() => (data?.requests ?? []).filter((x) => x.company !== "smoke-test"), [data]);
  const reqs = useMemo(() => all.filter((x) => {
    if (company !== "all" && x.company !== company) return false;
    if (view === "active" && (DONE.has(x.status) || x.status === "escalated")) return false;
    if (view === "review" && x.status !== "escalated") return false;
    if (view === "done" && !DONE.has(x.status)) return false;
    if (q && !`${x.title} ${x.company} ${x.address}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [all, view, company, q]);
  const counts = useMemo(() => ({
    active: all.filter((x) => !DONE.has(x.status) && x.status !== "escalated").length,
    review: all.filter((x) => x.status === "escalated").length,
    done: all.filter((x) => DONE.has(x.status)).length,
    all: all.length,
  }), [all]);
  const open = all.find((x) => x.id === openId) ?? null;

  if (!key || authErr) {
    return (
      <Shell>
        <div style={{ maxWidth: 420, margin: "10vh auto 0", ...card, padding: 28, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Logo /><span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 17, color: C.heading }}>operis.</span></div>
          <span style={{ ...mono, color: C.muted }}>Founders only</span>
          <h1 style={{ ...display, fontSize: 32, margin: 0, color: C.heading }}>Backoffice</h1>
          <p style={{ margin: 0, color: C.muted }}>Sign in with your Operis founder email.</p>
          {authErr && !loginErr && <Notice warn>Your session expired. Sign in again.</Notice>}
          {loginErr && <Notice>{loginErr}</Notice>}
          <GoogleButton flow="admin" label="Sign in with Google" />
          <Divider>or with password</Divider>
          <form style={{ display: "flex", flexDirection: "column", gap: 10 }} onSubmit={async (e) => {
            e.preventDefault(); setSigningIn(true); setLoginErr("");
            const r = await fetch("/api/v1/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(login) });
            const j = await r.json().catch(() => ({}));
            setSigningIn(false);
            if (!r.ok || !j.token) return setLoginErr(j.error ?? `Sign-in failed (${r.status}).`);
            localStorage.setItem("operis_admin", j.token); localStorage.setItem("operis_admin_email", j.email);
            setMe(j.email); setKey(j.token); setAuthErr(false); first.current = true;
          }}>
            <Input type="email" required autoComplete="username" placeholder="Email" value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} autoFocus />
            <PasswordInput required autoComplete="current-password" placeholder="Password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} style={{ fontFamily: "inherit", fontSize: 15, padding: "13px 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.text }} />
            <button disabled={signingIn} style={{ ...btn, background: C.accent, color: "#F7F4EE", minHeight: 50 }}>{signingIn ? "Signing in…" : "Sign in"}</button>
          </form>
        </div>
      </Shell>
    );
  }

  const s = data?.stats; const m = data?.money; const st = data?.stages ?? {};
  return (
    <Shell>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px 8px 10px", ...card, borderRadius: 12 }}>
          <Logo /><span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 17, letterSpacing: "-0.02em", color: C.heading }}>operis.</span>
          <span style={{ ...mono, color: C.muted, marginLeft: 4 }}>Backoffice</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: C.muted, fontSize: 14, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className={`live-dot ${live ? "" : "off"}`} aria-hidden />{live ? "Live" : "Reconnecting…"}
          </span>
          {me && <span>{me}</span>}
          <button style={{ ...btn, background: C.card, border: `1px solid ${C.border}`, color: C.text, padding: "8px 14px" }}
            onClick={() => { localStorage.removeItem("operis_admin"); localStorage.removeItem("operis_admin_email"); setKey(null); setMe(null); }}>Sign out</button>
        </div>
      </header>

      <section style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginTop: 28 }}>
        <div>
          <span style={{ ...mono, color: C.muted }}>Autonomous company · 8 Naïve agents</span>
          <h1 style={{ ...display, fontSize: "clamp(32px, 4vw, 48px)", margin: "6px 0 0", color: C.heading, lineHeight: 1.05 }}>Requests coming in</h1>
        </div>
        {!!s?.escalated && (
          <button onClick={() => setView("review")} style={{ ...btn, background: C.warnSoft, color: C.warn, border: "1px solid #EBD5A8" }}>
            {s.escalated} proof{s.escalated > 1 ? "s" : ""} need a founder decision →
          </button>
        )}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 18 }}>
        <Kpi k="Requests · 24h" v={s?.today ?? "–"} />
        <Kpi k="In progress" v={s?.open ?? "–"} />
        <Kpi k="Needs review" v={s?.escalated ?? "–"} warn={!!s?.escalated} />
        <Kpi k="Paid jobs" v={s?.paid ?? "–"} />
        <Kpi k="Revenue" v={m ? usd(m.revenue) : "–"} sub={m ? `${usd(m.fees)} fees · ${usd(m.payouts)} to workers` : undefined} />
        <Kpi k="Companies" v={s?.companies ?? "–"} />
        <Kpi k="Agent calls · 24h" v={data?.call_stats?.total_24h ?? "–"} warn={!!data?.call_stats?.errors_24h}
          sub={data?.call_stats ? `${plural(data.call_stats.agents_24h, "agent")} · ${plural(data.call_stats.request_human_24h, "request")} · ${plural(data.call_stats.errors_24h, "error")}` : undefined} />
      </section>

      <section style={{ ...card, marginTop: 10, padding: "12px 14px", display: "flex", gap: 6, alignItems: "stretch", overflowX: "auto" }}>
        {FLOW.map((k, i) => {
          const n = st[k] ?? 0;
          return (
            <div key={k} style={{ flex: "1 0 116px", display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ flex: 1, background: n ? C.accentSoft : C.card2, borderRadius: 10, padding: "9px 12px" }}>
                <div style={{ ...mono, fontSize: 10, color: C.muted, whiteSpace: "nowrap" }}>{LABEL[k]}</div>
                <div style={{ ...display, fontSize: 24, color: n ? C.accentInk : C.faint }}>{n}</div>
              </div>
              {i < FLOW.length - 1 && <span style={{ color: C.faint }}>›</span>}
            </div>
          );
        })}
      </section>

      <AgentCalls calls={data?.calls ?? null} onOpenJob={(id) => setOpenId(id)} />

      <div className="bo2-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 14, marginTop: 14, alignItems: "start" }}>
        <section style={{ ...card, overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", gap: 4, background: C.card2, padding: 4, borderRadius: 10, flexWrap: "wrap" }}>
              {([["active", "Active"], ["review", "Needs review"], ["done", "Done"], ["all", "All"]] as const).map(([v, l]) => (
                <button key={v} onClick={() => setView(v)} style={{ ...btn, padding: "7px 12px", fontSize: 13, background: view === v ? C.card : "transparent", color: view === v ? C.heading : C.muted, boxShadow: view === v ? "0 1px 2px rgba(0,0,0,0.08)" : "none" }}>
                  {l} <span style={{ color: C.faint, marginLeft: 4 }}>{counts[v]}</span>
                </button>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <Input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 180, padding: "9px 12px", fontSize: 14 }} />
            <select value={company} onChange={(e) => setCompany(e.target.value)} style={{ fontFamily: "inherit", fontSize: 14, padding: "9px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.text, maxWidth: 220 }}>
              <option value="all">All companies</option>
              {(data?.companies ?? []).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          {!data && <div style={{ padding: 40, textAlign: "center", color: C.muted }}>Loading…</div>}
          {data && reqs.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: C.muted }}>
              {view === "review" ? "Nothing needs a founder decision." : view === "active" ? "No active requests right now." : "No requests here."}
            </div>
          )}
          {reqs.map((x) => {
            const [bg, fg] = tone(x.status);
            return (
              <button key={x.id} onClick={() => setOpenId(x.id)} className="bo2-row" style={{
                all: "unset", cursor: "pointer", display: "grid", gridTemplateColumns: "124px minmax(0, 1fr) 84px 64px", gap: 14, alignItems: "center",
                padding: "13px 16px", borderBottom: `1px solid ${C.border}`, width: "100%", boxSizing: "border-box",
                animation: fresh.has(x.id) ? "bo2flash 1.6s ease-out" : undefined,
              }}>
                <span style={{ justifySelf: "start", background: bg, color: fg, borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{LABEL[x.status] ?? x.status}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600, color: C.heading, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.title}</span>
                  <span style={{ display: "block", fontSize: 13, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {x.company ?? "?"} · {x.lat == null ? "Remote" : x.address}
                  </span>
                </span>
                <span style={{ ...display, fontSize: 18, color: C.heading, textAlign: "right" }}>{usd(Number(x.budget_usd))}</span>
                <span style={{ fontSize: 13, color: C.faint, textAlign: "right", whiteSpace: "nowrap" }}>{ago(x.created_at)}</span>
              </button>
            );
          })}
        </section>

        <aside style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <section style={{ background: C.ink, border: `1px solid ${C.inkLine}`, borderRadius: 16, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 style={{ ...display, fontSize: 20, margin: 0, color: "#F3EEE4" }}>Agent activity</h2>
              <span style={{ ...mono, color: C.sage }}>Live</span>
            </div>
            <FeedList items={data?.feed ?? []} />
          </section>
          <section style={{ ...card, padding: 18 }}>
            <h2 style={{ ...display, fontSize: 20, margin: "0 0 6px", color: C.heading }}>Companies</h2>
            {(data?.companies ?? []).length === 0 && <p style={{ color: C.muted, margin: 0 }}>No companies yet.</p>}
            {(data?.companies ?? []).slice(0, 12).map((c) => (
              <button key={c.id} onClick={() => { setCompany(c.name); setView("all"); }} style={{ all: "unset", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 0", borderTop: `1px solid ${C.border}`, width: "100%", boxSizing: "border-box" }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600, color: C.heading, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                  <span style={{ fontSize: 13, color: C.muted }}>{c.requests} request{c.requests === 1 ? "" : "s"} · {c.paid} paid · {usd(c.spend)}</span>
                </span>
                <span style={{ fontSize: 13, color: C.faint, whiteSpace: "nowrap" }}>{c.last_request_at ? ago(c.last_request_at) : "new"}</span>
              </button>
            ))}
          </section>
        </aside>
      </div>

      {open && <Drawer x={open} onClose={() => setOpenId(null)} />}
      <style>{`
        @media (min-width: 1080px) { .bo2-grid { grid-template-columns: minmax(0, 1fr) 380px !important; } }
        @media (max-width: 640px) { .bo2-row { grid-template-columns: minmax(0, 1fr) 70px !important; } .bo2-row > :first-child, .bo2-row > :last-child { display: none !important; } }
        .bo2-row:hover { background: ${C.card2}; }
        @keyframes bo2flash { from { background: ${C.accentSoft}; } to { background: transparent; } }
      `}</style>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ background: C.paper, minHeight: "100dvh", color: C.text }}>
      <div style={{ maxWidth: 1320, margin: "0 auto", padding: "18px clamp(14px, 3vw, 32px) 64px" }}>{children}</div>
    </main>
  );
}
function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ fontFamily: "inherit", fontSize: 15, padding: "13px 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.text, ...props.style }} />;
}
function Notice({ warn, children }: { warn?: boolean; children: React.ReactNode }) {
  return <div style={{ borderRadius: 10, padding: "10px 12px", fontSize: 14, background: warn ? C.warnSoft : C.badSoft, color: warn ? C.warn : C.bad }}>{children}</div>;
}
function Kpi({ k, v, sub, warn }: { k: string; v: string | number; sub?: string; warn?: boolean }) {
  return (
    <div style={{ ...card, padding: "14px 16px", background: warn ? C.warnSoft : C.card, borderColor: warn ? "#EBD5A8" : C.border }}>
      <div style={{ ...mono, color: warn ? C.warn : C.muted }}>{k}</div>
      <div style={{ ...display, fontSize: 34, color: warn ? C.warn : C.heading, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{v}</div>
      {sub && <div style={{ fontSize: 12, color: C.muted }}>{sub}</div>}
    </div>
  );
}
function FeedList({ items }: { items: Feed[] }) {
  const rows = items.map(humanize).filter((r): r is Line => !!r);
  if (!rows.length) return <p style={{ margin: "12px 0 0", color: C.faint, fontSize: 14 }}>No agent activity yet. It shows up within seconds of a job being funded.</p>;
  return (
    <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, maxHeight: 480, overflowY: "auto" }}>
      {rows.slice(0, 40).map((r, i) => (
        <li key={i} style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr) 54px", gap: 10, alignItems: "start", padding: "9px 0", borderTop: i ? `1px solid ${C.inkLine}` : "none" }}>
          <span style={{ justifySelf: "start", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 999, background: C.inkCard, color: AGENT_COLOR[r.who] ?? C.sage }}>{r.who}</span>
          <span style={{ fontSize: 14, color: r.kind === "wait" ? "#E8C88A" : r.kind === "auto" ? "#8E958C" : "#E9E5DC", lineHeight: 1.45, overflowWrap: "anywhere" }}>
            {r.kind === "say" ? <>&ldquo;{r.text.length > 150 ? r.text.slice(0, 150) + "…" : r.text}&rdquo;</> : r.text}
          </span>
          <span style={{ fontSize: 12, color: "#8E958C", textAlign: "right", whiteSpace: "nowrap" }}>{ago(r.at)}</span>
        </li>
      ))}
    </ul>
  );
}
function Drawer({ x, onClose }: { x: Req; onClose: () => void }) {
  const at = FLOW.indexOf(x.status as (typeof FLOW)[number]);
  const [bg, fg] = tone(x.status);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(23,33,26,0.35)", zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
      <aside onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", height: "100%", overflowY: "auto", background: C.paper, borderLeft: `1px solid ${C.border}`, padding: 24, display: "flex", flexDirection: "column", gap: 14, boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <span style={{ ...mono, color: C.muted }}>{x.company ?? "?"}</span>
            <h2 style={{ ...display, fontSize: 28, margin: "6px 0 0", color: C.heading, lineHeight: 1.1 }}>{x.title}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ ...btn, background: C.card, border: `1px solid ${C.border}`, padding: "6px 12px" }}>✕</button>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ background: bg, color: fg, borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 600 }}>{LABEL[x.status] ?? x.status}</span>
          <span style={{ ...display, fontSize: 22, color: C.heading }}>{usd(Number(x.budget_usd))}</span>
          <span style={{ color: C.muted, fontSize: 13 }}>worker {usd(Number(x.worker_pay_usd))} · fee {usd(Number(x.fee_usd))}</span>
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {FLOW.map((k, i) => (
            <span key={k} style={{ fontSize: 11.5, fontWeight: 600, padding: "5px 9px", borderRadius: 7, background: i < at ? C.accentSoft : i === at ? C.accent : C.card2, color: i < at ? C.accentInk : i === at ? "#F7F4EE" : C.faint }}>{LABEL[k]}</span>
          ))}
          {at === -1 && <span style={{ fontSize: 11.5, fontWeight: 600, padding: "5px 9px", borderRadius: 7, background: C.warnSoft, color: C.warn }}>{LABEL[x.status] ?? x.status}</span>}
        </div>
        <section style={{ ...card, padding: 16, display: "grid", gap: 8, fontSize: 14 }}>
          <Row k="Where" v={x.lat == null ? "Remote" : x.address} />
          <Row k="Deadline" v={new Date(x.deadline).toLocaleString()} />
          <Row k="Worker" v={x.worker_name ?? (x.invited ? `${x.invited} invited, waiting for a yes` : "not yet")} />
          <Row k="Contact" v={x.contact_email ?? "?"} />
          <Row k="Requested" v={`${ago(x.created_at)} · updated ${ago(x.updated_at)}`} />
        </section>
        <section style={{ ...card, padding: 16 }}>
          <div style={{ ...mono, color: C.muted, marginBottom: 6 }}>Instructions</div>
          <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.55 }}>{x.instructions}</p>
        </section>
        {x.proof && (
          <section style={{ ...card, padding: 16 }}>
            <div style={{ ...mono, color: C.muted, marginBottom: 6 }}>Proof · {x.proof.status} · score {x.proof.score ?? "–"}</div>
            {x.proof.notes && <p style={{ margin: "0 0 10px", fontSize: 13, color: C.muted }}>{x.proof.notes}</p>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(x.proof.media ?? []).map((md) => md.kind?.startsWith("image/")
                // eslint-disable-next-line @next/next/no-img-element
                ? <a key={md.url} href={md.url} target="_blank" rel="noreferrer"><img src={md.url} alt="" style={{ height: 120, borderRadius: 10, objectFit: "cover", border: `1px solid ${C.border}` }} /></a>
                : <a key={md.url} href={md.url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>{md.kind}</a>)}
            </div>
          </section>
        )}
        <section style={{ background: C.ink, borderRadius: 16, padding: 16 }}>
          <div style={{ ...mono, color: C.sage }}>What the agents did</div>
          <FeedList items={(x.activity ?? []).slice().reverse().map((a) => ({ ...a, created_at: a.at }))} />
        </section>
        <div style={{ fontFamily: "var(--font-code)", fontSize: 12, color: C.faint }}>job {x.id}</div>
      </aside>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 10 }}><span style={{ color: C.muted }}>{k}</span><span style={{ color: C.text, overflowWrap: "anywhere" }}>{v}</span></div>;
}

// ---------- calls from customer agents (api_calls) ----------
const OUTCOME: Record<Call["outcome"], [string, string, string]> = {
  ok: ["OK", "#E2EADE", "#2F4A37"],
  rejected: ["Rejected", "#F6EAD3", "#8A5300"],
  error: ["Error", "#F6E1DE", "#A12A22"],
  unauthorized: ["No key", "#F3EFE7", "#5B635C"],
};
const CALL_LABEL: Record<string, string> = {
  request_human: "request_human", get_job: "get_job", cancel_job: "cancel_job", setup_payment: "setup_payment",
  initialize: "connect", "tools/list": "list tools", "POST /v1/customers": "sign-up", "oauth/token": "OAuth connect",
};
function AgentCalls({ calls, onOpenJob }: { calls: Call[] | null; onOpenJob: (id: string) => void }) {
  const [filter, setFilter] = useState<"all" | "requests" | "problems">("all");
  const [more, setMore] = useState(false);
  const seenIds = useRef<Set<number> | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!calls) return;
    if (seenIds.current) setFresh(new Set(calls.filter((c) => !seenIds.current!.has(c.id)).map((c) => c.id)));
    seenIds.current = new Set(calls.map((c) => c.id));
  }, [calls]);
  const list = (calls ?? []).filter((c) =>
    filter === "requests" ? c.tool === "request_human" : filter === "problems" ? c.outcome !== "ok" : true);
  const shown = list.slice(0, more ? 150 : 12);
  const count = (f: typeof filter) => (calls ?? []).filter((c) => (f === "requests" ? c.tool === "request_human" : f === "problems" ? c.outcome !== "ok" : true)).length;
  return (
    <section style={{ ...card, marginTop: 14, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${C.border}` }}>
        <div>
          <h2 style={{ ...display, fontSize: 20, margin: 0, color: C.heading }}>Calls from agents</h2>
          <div style={{ fontSize: 13, color: C.muted }}>Every call customer agents make to Operis, live: connects, requests, status checks, errors.</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 4, background: C.card2, padding: 4, borderRadius: 10 }}>
          {([["all", "All"], ["requests", "Job requests"], ["problems", "Errors & rejected"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)} style={{ ...btn, padding: "7px 12px", fontSize: 13, background: filter === v ? C.card : "transparent", color: filter === v ? C.heading : C.muted, boxShadow: filter === v ? "0 1px 2px rgba(0,0,0,0.08)" : "none" }}>
              {l} <span style={{ color: C.faint, marginLeft: 4 }}>{count(v)}</span>
            </button>
          ))}
        </div>
      </div>
      {!calls && <div style={{ padding: 28, textAlign: "center", color: C.muted }}>Loading…</div>}
      {calls && shown.length === 0 && <div style={{ padding: 28, textAlign: "center", color: C.muted }}>No calls yet. They appear here within seconds of an agent connecting.</div>}
      {shown.map((c) => {
        const [label, bg, fg] = OUTCOME[c.outcome] ?? OUTCOME.ok;
        const call = CALL_LABEL[c.tool ?? c.method ?? ""] ?? c.tool ?? c.method ?? c.channel;
        const clickable = !!c.job_id;
        return (
          <div key={c.id} onClick={clickable ? () => onOpenJob(c.job_id!) : undefined} className="bo2-call" style={{
            display: "grid", gridTemplateColumns: "70px 84px minmax(110px, 180px) 120px minmax(0, 1fr)", gap: 12, alignItems: "center",
            padding: "10px 16px", borderBottom: `1px solid ${C.border}`, cursor: clickable ? "pointer" : "default",
            animation: fresh.has(c.id) ? "bo2flash 1.6s ease-out" : undefined,
          }}>
            <span style={{ fontSize: 13, color: C.faint, whiteSpace: "nowrap" }} title={new Date(c.at).toLocaleString()}>{ago(c.at)}</span>
            <span style={{ justifySelf: "start", background: bg, color: fg, borderRadius: 999, padding: "3px 9px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{label}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 600, color: C.heading, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.customer_name ?? "Unknown agent"}</span>
              <span style={{ display: "block", fontSize: 12, color: C.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={c.client ?? ""}>{c.client ?? c.channel}</span>
            </span>
            <span style={{ fontFamily: "var(--font-code)", fontSize: 12.5, color: C.accentInk, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{call}</span>
            <span style={{ fontSize: 14, color: C.text, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.summary ?? ""}>
              {c.summary ?? ""}{c.duration_ms != null && <span style={{ color: C.faint, fontSize: 12 }}> · {c.duration_ms} ms</span>}
            </span>
          </div>
        );
      })}
      {list.length > 12 && (
        <button onClick={() => setMore((m) => !m)} style={{ ...btn, width: "100%", borderRadius: 0, background: C.card2, color: C.accentInk, fontSize: 13 }}>
          {more ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
      <style>{`
        .bo2-call:hover { background: ${C.card2}; }
        @media (max-width: 760px) { .bo2-call { grid-template-columns: 60px 76px minmax(0, 1fr) !important; } .bo2-call > :nth-child(4), .bo2-call > :nth-child(5) { grid-column: 1 / -1; } }
      `}</style>
    </section>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
