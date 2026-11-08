"use client";

import { useEffect, useRef, useState } from "react";

import { getDashboard, type Dashboard as Data } from "@/lib/api";
import { ago, usd } from "@/lib/format";
import { Logo } from "@/components/Icon";
import JobsMap from "./JobsMap";

const POLL_MS = 3000;
const HAPPY_PATH = ["requested", "held", "outreach", "accepted", "proof_submitted", "approved", "paid"];
const SIDE = ["escalated", "rejected", "cancelled", "expired", "refunded"];

export default function Dashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [live, setLive] = useState(true);
  const [, tick] = useState(0);
  const seen = useRef<Set<string>>(new Set());
  const first = useRef(true);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const r = await getDashboard();
      if (!alive) return;
      if (r.ok) {
        setData(r.data);
        setLive(true);
      } else setLive(false);
      timer = setTimeout(poll, document.hidden ? POLL_MS * 4 : POLL_MS);
    };
    poll();
    const clock = setInterval(() => tick((n) => n + 1), 5000); // keep "12s ago" fresh
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, []);

  // Highlight feed rows that arrived since the last poll (not on first load).
  const fresh = new Set<string>();
  if (data) {
    for (const e of [...data.agent_feed, ...data.timeline]) {
      const k = feedKey(e);
      if (!seen.current.has(k)) {
        if (!first.current) fresh.add(k);
        seen.current.add(k);
      }
    }
    first.current = false;
  }

  const active = data?.active_job ?? null;
  const m = data?.money ?? { revenue: 0, payouts: 0, fees: 0, refunds: 0 };

  return (
    <main className="dash">
      <header className="a-head row between wrap">
        <span className="brand"><Logo /> operis.</span>
        <div className="row small muted">
          <span className={`live-dot ${live ? "" : "off"}`} aria-hidden />
          {live ? "Live" : "Reconnecting…"}
          <span className="eyebrow" style={{ marginLeft: 8 }}>Autonomous company · 5 Naïve agents</span>
        </div>
      </header>

      <section className="a-money tiles" aria-label="Money">
        <Tile k="Revenue" v={usd(m.revenue)} />
        <Tile k="Paid to workers" v={usd(m.payouts)} />
        <Tile k="Operis fees" v={usd(m.fees)} />
        <Tile k="Refunds" v={usd(m.refunds)} />
      </section>

      <section className="a-map card stack">
        <div className="row between">
          <h2>Jobs on the map</h2>
          <span className="small muted">{data?.jobs.length ?? 0} recent</span>
        </div>
        <JobsMap jobs={data?.jobs ?? []} activeId={active?.id ?? null} />
      </section>

      <section className="a-live card stack">
        <div className="row between wrap">
          <h2>Live job</h2>
          {active && <span className="pill good">{active.status.replace(/_/g, " ")}</span>}
        </div>
        {active ? (
          <>
            <div>
              <strong style={{ fontSize: "1.15rem" }}>{active.title}</strong>
              <div className="small muted">{active.address} · budget {usd(active.budget_usd)} · updated {ago(active.updated_at)}</div>
            </div>
            <Pipeline status={active.status} />
          </>
        ) : (
          <p className="muted">{data ? "No job in flight right now." : "Loading…"}</p>
        )}
      </section>

      <section className="a-feed card stack">
        <h2>Agent feed</h2>
        {data && data.agent_feed.length === 0 && <p className="muted small">No agent activity yet.</p>}
        <ul className="feed">
          {data?.agent_feed.map((e) => (
            <li key={feedKey(e)} className={fresh.has(feedKey(e)) ? "fresh" : ""}>
              <div className="row between">
                <span className={`pill ${e.type === "tool.confirm" || e.type === "budget.exceeded" ? "warn" : ""}`}>{e.type}</span>
                <span className="small muted">{ago(e.created_at)}</span>
              </div>
              <span>{e.summary ?? e.type}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="a-jobs card stack">
        <h2>Recent jobs</h2>
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr><th>Job</th><th>Status</th><th className="num">Budget</th><th className="num">Updated</th></tr>
            </thead>
            <tbody>
              {data?.jobs.map((j) => (
                <tr key={j.id}>
                  <td><strong>{j.title}</strong><div className="small muted">{j.address}</div></td>
                  <td><StatusPill status={j.status} /></td>
                  <td className="num">{usd(j.budget_usd)}</td>
                  <td className="num small muted">{ago(j.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="a-timeline card stack">
        <h2>Agent wake-ups</h2>
        {data && data.timeline.length === 0 && <p className="muted small">No wake-ups yet.</p>}
        <ul className="feed">
          {data?.timeline.map((t) => (
            <li key={feedKey(t)} className={fresh.has(feedKey(t)) ? "fresh" : ""}>
              <div className="row between">
                <strong>{t.event.replace(/_/g, " ")}</strong>
                <span className="small muted">{ago(t.created_at)}</span>
              </div>
              <span className="small muted mono">job {t.job_id.slice(0, 8)}{t.naive_session_id ? ` · session ${t.naive_session_id.slice(0, 10)}` : ""}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function Tile({ k, v }: { k: string; v: string }) {
  return (
    <div className="card tile">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

function Pipeline({ status }: { status: string }) {
  const side = SIDE.includes(status);
  const idx = side ? HAPPY_PATH.indexOf("proof_submitted") : HAPPY_PATH.indexOf(status);
  return (
    <div className="pipeline" aria-label={`Status: ${status}`}>
      {HAPPY_PATH.map((s, i) => (
        <span key={s} className={i < idx || (side && i === idx) ? "done" : i === idx ? "now" : ""}>{s.replace(/_/g, " ")}</span>
      ))}
      {side && <span className="alt">{status}</span>}
    </div>
  );
}

const TONE: Record<string, string> = {
  paid: "good", approved: "good", accepted: "good",
  outreach: "info", held: "info", proof_submitted: "info",
  escalated: "warn", requested: "",
  rejected: "bad", refunded: "bad", expired: "", cancelled: "",
};

function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${TONE[status] ?? ""}`}>{status.replace(/_/g, " ")}</span>;
}

function feedKey(e: { created_at: string; type?: string; event?: string; job_id?: string; summary?: string | null }) {
  return `${e.created_at}|${e.type ?? e.event}|${e.job_id ?? ""}|${(e.summary ?? "").slice(0, 40)}`;
}
